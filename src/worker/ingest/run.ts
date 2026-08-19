import type { ProductSourceAdapter } from "../adapters/types";
import type { Env } from "../env";
import {
  createIngestRun,
  createStagingVersion,
  ensureCatalogState,
  finishIngestRun,
  getActiveVersionId,
  insertOffers,
  insertProducts,
  setVersionStatus,
  publishVersion,
} from "../repo/catalog";
import type { CatalogProduct } from "../../shared/domain/types";
import type { RiceCookerCriteria, RiceCookerProduct } from "../../shared/domain/rice-cooker/types";
import { deriveCriteria } from "../../shared/domain/rice-cooker/module";
import { riceCookerModule } from "../../shared/domain/registry";
import {
  countGate,
  fixtureGate,
  hardConditionRegressionGate,
  rangeGate,
  schemaGate,
  uniquenessGate,
  versionRegressionGate,
  type QualityGateResult,
} from "./quality-gates";

export interface IngestSummary {
  runId: string;
  status: "succeeded" | "rejected" | "failed";
  versionId: string | null;
  gates: QualityGateResult[];
  fetchedCount: number;
  normalizedCount: number;
  rejectedCount: number;
  errorSummary?: string;
}

const REGRESSION_SAMPLE_CRITERIA: RiceCookerCriteria[] = [
  deriveCriteria({ cookVolume: "3", heating: "any" }),
  deriveCriteria({ cookVolume: "5.5", heating: "ih" }),
  deriveCriteria({ cookVolume: "5.5", heating: "pressure_ih", installWidth: "under27" }),
];

/**
 * データ統合パイプライン（プロンプト§6, §7）。
 * fetch → normalize → 品質ゲート7種 → staging → valid → publish を実行する。
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
    const riceProducts = normalized.products as RiceCookerProduct[];

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
      rangeGate(riceProducts),
      fixtureGate(riceProducts),
      hardConditionRegressionGate(
        riceProducts,
        (p, criteria) => riceCookerModule.hardMatch(p, criteria as RiceCookerCriteria),
        REGRESSION_SAMPLE_CRITERIA
      ),
      versionRegressionGate(products.length, previousCount),
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
    await publishVersion(db, categoryKey, versionId, now);

    await finishIngestRun(db, runId, "succeeded", now, {
      fetchedCount: fetched.meta.fetchedCount,
      normalizedCount: normalized.products.length,
      rejectedCount: normalized.rejectedCount,
      candidateVersion: versionId,
    });

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
    await finishIngestRun(db, runId, "failed", now, {
      fetchedCount: 0,
      normalizedCount: 0,
      rejectedCount: 0,
      errorSummary: message,
    });
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
