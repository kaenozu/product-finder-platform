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
} from "../../src/worker/repo/catalog";
import { handleRedirect } from "../../src/worker/redirect";
import type { ProductOffer } from "../../src/shared/domain/types";
import type { RiceCookerProduct } from "../../src/shared/domain/rice-cooker/types";

const CATEGORY = "rice-cooker";
const workerEnv = env as unknown as Env;
const db = () => workerEnv.DB;

function makeProduct(id: string): RiceCookerProduct {
  return {
    productId: id,
    categoryKey: "rice-cooker",
    manufacturer: "TEST",
    model: id,
    displayName: id,
    specs: {
      capacityGou: 3,
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

async function seedOffer(overrides: Partial<ProductOffer> = {}) {
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
    ...overrides,
  };
  await insertOffers(db(), versionId, [offer]);
  await setVersionStatus(db(), versionId, "valid");
  await publishVersion(db(), CATEGORY, versionId);
}

describe("/go redirect", () => {
  beforeEach(async () => {
    await db().exec(
      "DELETE FROM click_events; DELETE FROM product_offers; DELETE FROM products; DELETE FROM catalog_versions; DELETE FROM catalog_state; DELETE FROM ingest_runs;"
    );
  });

  it("有効なオファーで302リダイレクトし、click_eventsに記録される", async () => {
    await seedOffer();
    const res = await handleRedirect(
      workerEnv,
      new Request("http://localhost/go/x"),
      "rakuten",
      "item-1"
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://item.rakuten.co.jp/example/item-1");

    const clicks = await db()
      .prepare(
        "SELECT provider_key, provider_item_id, product_id, category_key, version_id FROM click_events"
      )
      .all<{
        provider_key: string;
        provider_item_id: string;
        product_id: string;
        category_key: string;
        version_id: string;
      }>();
    expect(clicks.results).toHaveLength(1);
    expect(clicks.results![0]).toMatchObject({
      provider_key: "rakuten",
      provider_item_id: "item-1",
      product_id: "p-1",
      category_key: CATEGORY,
    });
  });

  it("providerキーが不正なら400", async () => {
    const res = await handleRedirect(
      workerEnv,
      new Request("http://localhost"),
      "bad/provider",
      "item-1"
    );
    expect(res.status).toBe(400);
  });

  it("存在しないオファーなら404", async () => {
    await seedOffer();
    const res = await handleRedirect(
      workerEnv,
      new Request("http://localhost"),
      "rakuten",
      "no-such-item"
    );
    expect(res.status).toBe(404);
  });

  it("publishedカタログが1つもない場合は404ではなく503 catalog_unavailable（Issue #13）", async () => {
    // seedOfferせず、カタログが空の状態で未知トークンを叩く
    const res = await handleRedirect(
      workerEnv,
      new Request("http://localhost"),
      "rakuten",
      "no-such-item"
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("catalog_unavailable");
  });

  it("https以外のoutbound_urlはリダイレクトしない（オープンリダイレクト対策）", async () => {
    await seedOffer({ outboundUrl: "http://evil.example.com/redirect" });
    const res = await handleRedirect(
      workerEnv,
      new Request("http://localhost"),
      "rakuten",
      "item-1"
    );
    expect(res.status).toBe(404);
  });

  it("httpsで始まっていてもURLとして不正ならリダイレクトしない", async () => {
    await seedOffer({ outboundUrl: "https://" });
    const res = await handleRedirect(
      workerEnv,
      new Request("http://localhost"),
      "rakuten",
      "item-1"
    );
    expect(res.status).toBe(404);
  });

  it("無効化カテゴリのofferへはリダイレクトしない", async () => {
    await seedOffer();
    const disabledEnv = { ...workerEnv, ENABLED_CATEGORIES: "" } as Env;
    const res = await handleRedirect(
      disabledEnv,
      new Request("http://localhost"),
      "rakuten",
      "item-1"
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("category_not_enabled");
  });
});
