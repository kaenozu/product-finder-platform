import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import type { Env } from "../../src/worker/env";
import {
  ensureCatalogState,
  createStagingVersion,
  insertProducts,
  insertOffers,
  publishVersion,
  setVersionStatus,
  listActiveProducts,
  getActiveProductById,
  listOffersForProducts,
  getActiveVersionId,
} from "../../src/worker/repo/catalog";
import { runIngest } from "../../src/worker/ingest/run";
import { ManualRiceCookerAdapter } from "../../src/worker/adapters/manual";
import { handleEvaluate, handleProductDetail } from "../../src/worker/api";
import type { ProductOffer } from "../../src/shared/domain/types";
import type { RiceCookerProduct } from "../../src/shared/domain/rice-cooker/types";

const CATEGORY = "rice-cooker";
const workerEnv = env as unknown as Env;
const db = () => workerEnv.DB;

function makeProduct(id: string, capacityGou = 3): RiceCookerProduct {
  return {
    productId: id,
    categoryKey: CATEGORY,
    manufacturer: "TEST",
    model: id,
    displayName: id,
    specs: {
      capacityGou,
      heatingMethod: "micom",
      powerW: null,
      weightKg: null,
      widthMm: 250,
      depthMm: 300,
      heightMm: 220,
      keepWarmHours: null,
      innerPot: null,
      features: [],
      releaseYear: null,
    },
    referencePriceYen: null,
    availability: "in_stock",
    sourceKey: "test",
    sourceUpdatedAt: "2026-08-19",
    ingestedAt: "2026-08-19T00:00:00.000Z",
  };
}

describe("catalog repository", () => {
  beforeEach(async () => {
    // テスト間で状態を分離
    await db().exec(
      "DELETE FROM product_offers; DELETE FROM products; DELETE FROM catalog_versions; DELETE FROM catalog_state; DELETE FROM ingest_runs;"
    );
  });

  it("staging → products投入 → valid → publish → active取得の一連の流れ", async () => {
    await ensureCatalogState(db(), CATEGORY);
    expect(await getActiveVersionId(db(), CATEGORY)).toBeNull();

    const p1 = makeProduct("p-1");
    const p2 = makeProduct("p-2", 5.5);
    const versionId = await createStagingVersion(db(), CATEGORY, "test", 2);
    await insertProducts(db(), versionId, [p1, p2]);
    await setVersionStatus(db(), versionId, "valid");
    await publishVersion(db(), CATEGORY, versionId);

    expect(await getActiveVersionId(db(), CATEGORY)).toBe(versionId);
    const active = await listActiveProducts(db(), CATEGORY);
    expect(active.map((p) => p.productId).sort()).toEqual(["p-1", "p-2"]);
    expect(active[0].specs).toEqual(p1.specs);

    const detail = await getActiveProductById(db(), CATEGORY, "p-2");
    expect(detail?.specs.capacityGou).toBe(5.5);
    expect(await getActiveProductById(db(), CATEGORY, "p-3")).toBeNull();
  });

  it("referencePriceYenがDBに永続化され復元できる", async () => {
    await ensureCatalogState(db(), CATEGORY);
    const p1 = { ...makeProduct("p-1"), referencePriceYen: 42500 };
    const versionId = await createStagingVersion(db(), CATEGORY, "test", 1);
    await insertProducts(db(), versionId, [p1]);
    await publishVersion(db(), CATEGORY, versionId);

    const active = await listActiveProducts(db(), CATEGORY);
    expect(active[0].referencePriceYen).toBe(42500);
    const detail = await getActiveProductById(db(), CATEGORY, "p-1");
    expect(detail?.referencePriceYen).toBe(42500);
  });

  it("offersの登録と取得ができる", async () => {
    await ensureCatalogState(db(), CATEGORY);
    const versionId = await createStagingVersion(db(), CATEGORY, "test", 1);
    await insertProducts(db(), versionId, [makeProduct("p-1")]);
    const offer: ProductOffer = {
      productId: "p-1",
      providerKey: "rakuten",
      providerItemId: "item-1",
      outboundUrl: "https://item.rakuten.co.jp/example/item-1",
      priceMinor: 2500000,
      currency: "JPY",
      availability: "in_stock",
      updatedAt: "2026-08-19T00:00:00Z",
    };
    await insertOffers(db(), versionId, [offer]);
    await publishVersion(db(), CATEGORY, versionId);

    const offers = await listOffersForProducts(db(), CATEGORY, ["p-1"]);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      productId: "p-1",
      providerKey: "rakuten",
      priceMinor: 2500000,
    });
  });

  it("別カテゴリのofferは混ざらない（categoryKeyでSQL絞り込み）", async () => {
    // rice-cookerのactive版にp-1のofferを登録
    await ensureCatalogState(db(), CATEGORY);
    const v1 = await createStagingVersion(db(), CATEGORY, "test", 1);
    await insertProducts(db(), v1, [makeProduct("p-1")]);
    await insertOffers(db(), v1, [
      {
        productId: "p-1",
        providerKey: "rakuten",
        providerItemId: "item-rice",
        outboundUrl: "https://item.rakuten.co.jp/example/rice",
        priceMinor: 100000,
        currency: "JPY",
        availability: "in_stock",
        updatedAt: "2026-08-19T00:00:00Z",
      },
    ]);
    await publishVersion(db(), CATEGORY, v1);

    // 別カテゴリのactive版にも同じproductIdのofferを登録
    const otherCategory = "other-cat";
    await ensureCatalogState(db(), otherCategory);
    const v2 = await createStagingVersion(db(), otherCategory, "test", 1);
    await insertProducts(db(), v2, [makeProduct("p-1", otherCategory as "rice-cooker")]);
    await insertOffers(db(), v2, [
      {
        productId: "p-1",
        providerKey: "rakuten",
        providerItemId: "item-other",
        outboundUrl: "https://item.rakuten.co.jp/example/other",
        priceMinor: 999999,
        currency: "JPY",
        availability: "in_stock",
        updatedAt: "2026-08-19T00:00:00Z",
      },
    ]);
    await publishVersion(db(), otherCategory, v2);

    const offers = await listOffersForProducts(db(), CATEGORY, ["p-1"]);
    expect(offers).toHaveLength(1);
    expect(offers[0].providerItemId).toBe("item-rice");
  });
});

describe("ingest pipeline（品質ゲート込み）", () => {
  beforeEach(async () => {
    await db().exec(
      "DELETE FROM product_offers; DELETE FROM products; DELETE FROM catalog_versions; DELETE FROM catalog_state; DELETE FROM ingest_runs;"
    );
  });

  it("manualアダプタで30商品以上が公開される", async () => {
    const summary = await runIngest(
      workerEnv,
      new ManualRiceCookerAdapter(),
      CATEGORY,
      new Date("2026-08-19T00:00:00Z")
    );
    expect(summary.status).toBe("succeeded");
    expect(summary.versionId).toBeTruthy();
    expect(summary.normalizedCount).toBeGreaterThanOrEqual(30);
    expect(summary.gates.every((g) => g.pass)).toBe(true);

    const active = await listActiveProducts(db(), CATEGORY);
    expect(active.length).toBe(summary.normalizedCount);

    const run = await db()
      .prepare("SELECT status, candidate_version FROM ingest_runs WHERE run_id = ?")
      .bind(summary.runId)
      .first<{ status: string; candidate_version: string | null }>();
    expect(run?.status).toBe("succeeded");
    expect(run?.candidate_version).toBe(summary.versionId);
  });

  it("同一内容の再取り込みは no-op でスキップされる（content hash）", async () => {
    const first = await runIngest(
      workerEnv,
      new ManualRiceCookerAdapter(),
      CATEGORY,
      new Date("2026-08-19T00:00:00Z")
    );
    expect(first.status).toBe("succeeded");

    const second = await runIngest(
      workerEnv,
      new ManualRiceCookerAdapter(),
      CATEGORY,
      new Date("2026-08-20T00:00:00Z")
    );
    expect(second.status).toBe("skipped");
    expect(second.versionId).toBeNull();

    // active 版は変化していない
    const active = await listActiveProducts(db(), CATEGORY);
    expect(active.length).toBe(first.normalizedCount);
  });

  it("内容が変わると再公開される（content hash 変化）", async () => {
    const first = await runIngest(
      workerEnv,
      new ManualRiceCookerAdapter(),
      CATEGORY,
      new Date("2026-08-19T00:00:00Z")
    );
    expect(first.status).toBe("succeeded");

    // 内容が変わったソースを模したアダプタ（1商品の容量を変える）
    const changedAdapter = new (class extends ManualRiceCookerAdapter {
      override async normalize(raw: FetchedResult, ctx: NormalizeContext) {
        const base = await super.normalize(raw, ctx);
        const products = base.products.map((p, i) =>
          i === 0 ? { ...p, specs: { ...p.specs, capacityGou: 10 } } : p
        );
        return { ...base, products };
      }
    })();
    const second = await runIngest(
      workerEnv,
      changedAdapter,
      CATEGORY,
      new Date("2026-08-20T00:00:00Z")
    );
    expect(second.status).toBe("succeeded");
    expect(second.versionId).not.toBeNull();
  });
});

describe("API handlers（D1連動）", () => {
  beforeEach(async () => {
    await db().exec(
      "DELETE FROM product_offers; DELETE FROM products; DELETE FROM catalog_versions; DELETE FROM catalog_state; DELETE FROM ingest_runs;"
    );
    await runIngest(
      workerEnv,
      new ManualRiceCookerAdapter(),
      CATEGORY,
      new Date("2026-08-19T00:00:00Z")
    );
  });

  it("evaluate: 完全回答でfinal・候補を返す", async () => {
    const res = await handleEvaluate(workerEnv, {
      categoryKey: "rice-cooker",
      answers: {
        cookVolume: "5.5",
        heating: "ih",
        budget: "any",
        priority: "taste",
        installWidth: "free",
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      maxScore: number;
      scoreLabels: Record<string, string>;
      candidates: Array<{
        totalScore: number;
        sources: unknown[];
        specItems: Array<{ key: string; label: string; value: string }>;
        scoreBreakdown: Record<string, number>;
      }>;
      noMatch: boolean;
      matchedCount: number;
    };
    expect(body.status).toBe("final");
    expect(body.noMatch).toBe(false);
    expect(body.candidates.length).toBeGreaterThan(0);
    // マッチ総数は表示候補（上位5件）以上
    expect(body.matchedCount).toBeGreaterThanOrEqual(body.candidates.length);
    // スコア降順
    for (let i = 1; i < body.candidates.length; i++) {
      expect(body.candidates[i - 1].totalScore).toBeGreaterThanOrEqual(
        body.candidates[i].totalScore
      );
    }
    // メタデータと表示用スペック・日本語ラベル
    expect(body.maxScore).toBeGreaterThan(0);
    expect(body.scoreLabels.fitScore).toBe("容量との相性");
    for (const c of body.candidates) {
      expect(c.specItems.length).toBeGreaterThan(0);
      expect(c.specItems[0].value).toMatch(/合$/);
      expect(Object.keys(c.scoreBreakdown).length).toBeGreaterThan(0);
    }
  });

  it("evaluate: 1問だけの回答で400（canShowPartialResultの保証）", async () => {
    const res = await handleEvaluate(workerEnv, {
      categoryKey: "rice-cooker",
      answers: { cookVolume: "5.5" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("insufficient_answers");
  });

  it("evaluate: 不正な回答キーで400", async () => {
    const res = await handleEvaluate(workerEnv, {
      categoryKey: "rice-cooker",
      answers: { bogusKey: "x" },
    });
    expect(res.status).toBe(400);
  });

  it("evaluate: 未知カテゴリで400", async () => {
    const res = await handleEvaluate(workerEnv, {
      categoryKey: "unknown-cat",
      answers: { cookVolume: "3" },
    });
    expect(res.status).toBe(400);
  });

  it("evaluate: 成立しない条件でnoMatch（狭いカタログで検証）", async () => {
    // 5.5合・幅24cm以下では候補が無いカタログを用意
    await db().exec(
      "DELETE FROM product_offers; DELETE FROM products; DELETE FROM catalog_versions; DELETE FROM catalog_state;"
    );
    await ensureCatalogState(db(), CATEGORY);
    const v = await createStagingVersion(db(), CATEGORY, "test", 1);
    await insertProducts(db(), v, [makeProduct("only-3gou", 3)]);
    await publishVersion(db(), CATEGORY, v);

    const res = await handleEvaluate(workerEnv, {
      categoryKey: "rice-cooker",
      answers: { cookVolume: "5.5", heating: "any", priority: "taste", installWidth: "under24" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { noMatch: boolean; noMatchReasons: string[] };
    expect(body.noMatch).toBe(true);
    expect(body.noMatchReasons.length).toBeGreaterThan(0);
  });

  it("product detail: 存在する商品を返す（sources含む）", async () => {
    const res = await handleProductDetail(workerEnv, "panasonic-sr-x910e");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      product: { productId: string };
      sources: Array<{ url: string }>;
      specItems: Array<{ key: string; value: string }>;
    };
    expect(body.product.productId).toBe("panasonic-sr-x910e");
    expect(body.sources.length).toBeGreaterThan(0);
    expect(body.sources[0].url).toMatch(/^https:\/\//);
    expect(body.specItems.some((s) => s.value.endsWith("合"))).toBe(true);
  });

  it("product detail: 存在しない商品で404", async () => {
    const res = await handleProductDetail(workerEnv, "nonexistent-product");
    expect(res.status).toBe(404);
  });
});
