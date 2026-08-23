import type { ProductSourceAdapter } from "../adapters/types";
import type { Env } from "../env";
import {
  createIngestRun,
  createStagingVersion,
  ensureCatalogState,
  finishIngestRun,
  getActiveVersionId,
  getLastContentHash,
  insertOffers,
  insertProducts,
  pruneOldVersions,
  setVersionStatus,
  publishVersion,
} from "../repo/catalog";
import type { CatalogProduct, CategoryModule } from "../../shared/domain/types";
import { getModule } from "../../shared/domain/registry";
import {
  countGate,
  freshnessGate,
  hardConditionRegressionGate,
  schemaGate,
  uniquenessGate,
  versionRegressionGate,
  type QualityGateResult,
} from "./quality-gates";

export interface IngestSummary {
  runId: string;
  status: "succeeded" | "rejected" | "failed" | "skipped";
  versionId: string | null;
  gates: QualityGateResult[];
  fetchedCount: number;
  normalizedCount: number;
  rejectedCount: number;
  errorSummary?: string;
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalizeValue((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * 商品+オファーの内容ハッシュ（順序・タイムスタンプに依存しない安定ハッシュで no-op 判定する）。
 * 内容が実質的に変わらない限り再取り込みをスキップできるように、
 * ingestedAt / sourceUpdatedAt / updatedAt はハッシュ対象から除外する。
 *
 * 32-bit FNV から SHA-256 へ移行済み。値は `sha256:<hex>` 形式。
 * 旧 FNV 形式（`sha256:` プレフィックスなしの短いhex）は後方互換のため
 * 毎回 mismatch として扱い、移行初回に1回だけ publish される。
 */
export async function contentHash(products: CatalogProduct[], offers: unknown[]): Promise<string> {
  const canonicalProducts = [...products]
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((p) => ({
      productId: p.productId,
      categoryKey: p.categoryKey,
      manufacturer: p.manufacturer,
      model: p.model,
      displayName: p.displayName,
      specs: canonicalizeValue(p.specs),
      referencePriceYen: p.referencePriceYen,
      availability: p.availability,
      sourceKey: p.sourceKey,
    }));
  const canonicalOffers = [...offers]
    .sort(
      (a, b) =>
        (a as { productId: string }).productId.localeCompare(
          (b as { productId: string }).productId
        ) ||
        (a as { providerKey: string }).providerKey.localeCompare(
          (b as { providerKey: string }).providerKey
        )
    )
    .map((o) => ({
      productId: (o as { productId: string }).productId,
      providerKey: (o as { providerKey: string }).providerKey,
      providerItemId: (o as { providerItemId?: string | null }).providerItemId ?? null,
      outboundUrl: (o as { outboundUrl: string }).outboundUrl,
      priceMinor: (o as { priceMinor: number | null }).priceMinor,
      currency: (o as { currency: string | null }).currency,
      availability: (o as { availability: string | null }).availability,
    }));
  const payload = JSON.stringify({ products: canonicalProducts, offers: canonicalOffers });
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

/**
 * content_hash が旧 32-bit FNV 形式かどうかを判定する。
 * 旧形式は `sha256:` プレフィックスを持たない短い hex 文字列。
 */
export function isLegacyHashFormat(hash: string): boolean {
  return !hash.startsWith("sha256:");
}

/** module の代表回答から hard-match 回帰ゲートを組み立てる（回答なしmoduleはスキップ） */
function buildHardMatchRegressionGates(
  module: CategoryModule<unknown, CatalogProduct>,
  products: CatalogProduct[]
): QualityGateResult[] {
  if (!module.regressionSampleAnswers || module.regressionSampleAnswers.length === 0) {
    return [];
  }
  const sampleCriteria = module.regressionSampleAnswers.map((answers) =>
    module.deriveCriteria(answers)
  );
  return [
    hardConditionRegressionGate(
      products,
      (p, criteria) => module.hardMatch(p, criteria),
      sampleCriteria
    ),
  ];
}

/** カテゴリ固有ゲートを products（共通ベース型）に適用する */
function moduleQualityGates(
  module: CategoryModule<unknown, CatalogProduct>,
  products: CatalogProduct[]
): QualityGateResult[] {
  if (!module.qualityGates) return [];
  return module.qualityGates(products as never);
}

/**
 * データ統合パイプライン（プロンプト§6, §7）。
 * fetch → normalize → 品質ゲート7種 → staging → valid → publish を実行する。
 * カテゴリ固有のゲート・回帰条件は module から取得し、汎用的に動作する。
 * ゲート失敗時は publish せず rejected で記録する（条件は自動緩和しない）。
 */
export async function runIngest(
  env: Env,
  adapter: ProductSourceAdapter,
  categoryKey: string,
  now: Date = new Date()
): Promise<IngestSummary> {
  const db = env.DB;
  await ensureCatalogState(db, categoryKey, now);
  const runId = await createIngestRun(db, adapter.sourceKey, categoryKey, now);

  try {
    const fetched = await adapter.fetch({ categoryKey, now });
    const normalized = await adapter.normalize(fetched, { categoryKey, now });

    const products = normalized.products as CatalogProduct[];
    const module = getModule(categoryKey);
    const hash = await contentHash(products, normalized.offers);

    // 前回公開版の商品数（version回帰ゲート用）
    const previousActiveVersion = await getActiveVersionId(db, categoryKey);
    const previousCount =
      previousActiveVersion === null
        ? null
        : ((
            await db
              .prepare("SELECT COUNT(*) AS c FROM products WHERE version_id = ?")
              .bind(previousActiveVersion)
              .first<{ c: number }>()
          )?.c ?? 0);

    const gates: QualityGateResult[] = [
      schemaGate(normalized.rejectedCount),
      countGate(products.length),
      uniquenessGate(products),
      ...moduleQualityGates(module, products),
      ...buildHardMatchRegressionGates(module, products),
      versionRegressionGate(products.length, previousCount),
      freshnessGate(products, now),
    ];

    const failed = gates.filter((g) => !g.pass);
    if (failed.length > 0) {
      const summary = failed.map((g) => `[${g.name}] ${g.message}`).join("; ");
      await finishIngestRun(db, runId, "rejected", now, {
        fetchedCount: fetched.meta.fetchedCount,
        normalizedCount: normalized.products.length,
        rejectedCount: normalized.rejectedCount,
        errorSummary: `quality gate rejected: ${summary}`,
      });
      return {
        runId,
        status: "rejected",
        versionId: null,
        gates,
        fetchedCount: fetched.meta.fetchedCount,
        normalizedCount: normalized.products.length,
        rejectedCount: normalized.rejectedCount,
        errorSummary: summary,
      };
    }

    // no-opでも鮮度・schemaを含む全品質ゲートを毎回通し、古い/破損データを成功扱いしない。
    const lastHash = await getLastContentHash(db, categoryKey, adapter.sourceKey);
    if (lastHash !== null && lastHash === hash) {
      await finishIngestRun(db, runId, "succeeded", now, {
        fetchedCount: fetched.meta.fetchedCount,
        normalizedCount: normalized.products.length,
        rejectedCount: normalized.rejectedCount,
        contentHash: hash,
      });
      return {
        runId,
        status: "skipped",
        versionId: null,
        gates,
        fetchedCount: fetched.meta.fetchedCount,
        normalizedCount: normalized.products.length,
        rejectedCount: normalized.rejectedCount,
        errorSummary: "content unchanged (skipped)",
      };
    }

    const versionId = await createStagingVersion(
      db,
      categoryKey,
      adapter.sourceKey,
      products.length,
      now
    );
    await insertProducts(db, versionId, products);
    await insertOffers(db, versionId, normalized.offers);
    await setVersionStatus(db, versionId, "valid", now);
    const published = await publishVersion(db, categoryKey, versionId, now);
    if (!published) {
      const errorSummary = "newer active catalog already published";
      await finishIngestRun(db, runId, "rejected", now, {
        fetchedCount: fetched.meta.fetchedCount,
        normalizedCount: normalized.products.length,
        rejectedCount: normalized.rejectedCount,
        candidateVersion: versionId,
        errorSummary,
      });
      return {
        runId,
        status: "rejected",
        versionId: null,
        gates,
        fetchedCount: fetched.meta.fetchedCount,
        normalizedCount: normalized.products.length,
        rejectedCount: normalized.rejectedCount,
        errorSummary,
      };
    }

    // catalogは既にpublish済み。finishIngestRun失敗はaudit損失であって
    // serving integrityの問題ではないため、gracefulに処理する。
    try {
      await finishIngestRun(db, runId, "succeeded", now, {
        fetchedCount: fetched.meta.fetchedCount,
        normalizedCount: normalized.products.length,
        rejectedCount: normalized.rejectedCount,
        candidateVersion: versionId,
        contentHash: hash,
      });
    } catch (auditError) {
      // audit更新失敗はlogするが、publish済みcatalogのservingには影響しない。
      // reconcileStaleIngestRuns() が後から回復する。
      console.error(
        `[ingest] post-publish audit failed run=${runId} category=${categoryKey}: ${String(auditError)}`
      );
    }

    // 非公開の古いstaging/rejectedバージョンを整理（最新2件まで残す）
    try {
      await pruneOldVersions(db, categoryKey, 2);
    } catch (error) {
      console.error(`[ingest] prune failed category=${categoryKey}: ${String(error)}`);
    }

    return {
      runId,
      status: "succeeded",
      versionId,
      gates,
      fetchedCount: fetched.meta.fetchedCount,
      normalizedCount: normalized.products.length,
      rejectedCount: normalized.rejectedCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // finishIngestRun自体が失敗してもservingに影響しない。
    try {
      await finishIngestRun(db, runId, "failed", now, {
        fetchedCount: 0,
        normalizedCount: 0,
        rejectedCount: 0,
        errorSummary: message,
      });
    } catch (auditError) {
      console.error(`[ingest] audit update failed run=${runId}: ${String(auditError)}`);
    }
    return {
      runId,
      status: "failed",
      versionId: null,
      gates: [],
      fetchedCount: 0,
      normalizedCount: 0,
      rejectedCount: 0,
      errorSummary: message,
    };
  }
}
