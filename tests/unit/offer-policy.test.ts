/**
 * Issue #16: offer・価格取得パイプラインの回帰テスト。
 *
 * 受入条件:
 * - offer freshness 上限が定義される
 * - stale offer は UI/API で新鮮な実売価格として扱われない
 * - 価格なし / 在庫不明 / 在庫なし / 在庫ありを区別できる
 * - out_of_stock offer だけの場合に「購入する」CTA を表示しない
 * - currency と priceMinor の換算契約を型/関数に集約し、JPY を含めて検証
 */
import { describe, expect, it } from "vitest";
import {
  OFFER_MAX_AGE_MS,
  isOfferFresh,
  filterFreshOffers,
  getCtaPolicy,
  formatPrice,
  toYen,
  isSupportedCurrency,
  bestFreshPriceYen,
  hasAvailableOffer,
  shouldKeepStaleOffer,
} from "../../src/worker/offer-policy";
import type { ProductOffer } from "../../src/shared/domain/types";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeOffer(overrides: Partial<ProductOffer> & { providerItemId: string }): ProductOffer {
  return {
    productId: "test-product",
    providerKey: "test-provider",
    outboundUrl: "https://example.com/buy",
    priceMinor: 10000,
    currency: "JPY",
    availability: "in_stock",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Freshness
// ──────────────────────────────────────────────

describe("offer freshness", () => {
  it("OFFER_MAX_AGE_MS は7日（ミリ秒）", () => {
    expect(OFFER_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("今日の offer は鮮度あり", () => {
    const offer = makeOffer({ providerItemId: "1" });
    expect(isOfferFresh(offer)).toBe(true);
  });

  it("6日前の offer は鮮度あり", () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const offer = makeOffer({
      providerItemId: "1",
      updatedAt: sixDaysAgo.toISOString(),
    });
    expect(isOfferFresh(offer)).toBe(true);
  });

  it("8日前の offer は鮮度切れ", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const offer = makeOffer({
      providerItemId: "1",
      updatedAt: eightDaysAgo.toISOString(),
    });
    expect(isOfferFresh(offer)).toBe(false);
  });

  it("filterFreshOffers は鮮度切れ offer を除外する", () => {
    const fresh = makeOffer({
      providerItemId: "fresh",
      updatedAt: new Date().toISOString(),
    });
    const stale = makeOffer({
      providerItemId: "stale",
      updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const result = filterFreshOffers([fresh, stale]);
    expect(result).toHaveLength(1);
    expect(result[0]!.providerItemId).toBe("fresh");
  });
});

// ──────────────────────────────────────────────
// Currency / priceMinor
// ──────────────────────────────────────────────

describe("currency and priceMinor contract", () => {
  it("JPY の priceMinor は 100:1（1 priceMinor = 0.01 円）", () => {
    expect(toYen(1234500, "JPY")).toBe(12345);
  });

  it("USD の priceMinor は 100:1（1 priceMinor = $0.01）", () => {
    expect(toYen(12345, "USD")).toBe(123.45);
  });

  it("formatPrice は JPY を正しくフォーマット", () => {
    expect(formatPrice(1234500, "JPY")).toBe("12,345円");
  });

  it("formatPrice は USD を正しくフォーマット", () => {
    expect(formatPrice(12345, "USD")).toBe("$123.45");
  });

  it("isSupportedCurrency は JPY をサポート", () => {
    expect(isSupportedCurrency("JPY")).toBe(true);
  });

  it("isSupportedCurrency は未知の通貨を非サポート", () => {
    expect(isSupportedCurrency("GBP")).toBe(false);
  });
});

// ──────────────────────────────────────────────
// Availability → CTA
// ──────────────────────────────────────────────

describe("availability CTA policy", () => {
  it("in_stock は購入可（primary）", () => {
    const policy = getCtaPolicy("in_stock");
    expect(policy.canPurchase).toBe(true);
    expect(policy.ctaVariant).toBe("primary");
    expect(policy.ctaLabel).toBe("購入する");
  });

  it("low_stock は購入可（secondary）", () => {
    const policy = getCtaPolicy("low_stock");
    expect(policy.canPurchase).toBe(true);
    expect(policy.ctaVariant).toBe("secondary");
  });

  it("out_of_stock は購入不可（disabled）", () => {
    const policy = getCtaPolicy("out_of_stock");
    expect(policy.canPurchase).toBe(false);
    expect(policy.ctaVariant).toBe("disabled");
    expect(policy.ctaLabel).toBe("在庫なし");
  });

  it("unknown は有条件的（secondary）", () => {
    const policy = getCtaPolicy("unknown");
    expect(policy.canPurchase).toBe(true);
    expect(policy.ctaVariant).toBe("secondary");
    expect(policy.ctaLabel).toBe("在庫確認");
  });

  it("null は unknown として扱う", () => {
    const policy = getCtaPolicy(null);
    expect(policy.canPurchase).toBe(true);
    expect(policy.ctaLabel).toBe("在庫確認");
  });
});

// ──────────────────────────────────────────────
// bestFreshPriceYen
// ──────────────────────────────────────────────

describe("bestFreshPriceYen", () => {
  it("鮮度のある offer の最安値を返す", () => {
    const offers = [
      makeOffer({ providerItemId: "1", priceMinor: 1500000 }),
      makeOffer({ providerItemId: "2", priceMinor: 1200000 }),
      makeOffer({ providerItemId: "3", priceMinor: 1800000 }),
    ];
    expect(bestFreshPriceYen(offers)).toBe(12000);
  });

  it("鮮度切れの offer は無視する", () => {
    const fresh = makeOffer({
      providerItemId: "fresh",
      priceMinor: 1500000,
      updatedAt: new Date().toISOString(),
    });
    const stale = makeOffer({
      providerItemId: "stale",
      priceMinor: 800000, // 最安値だが鮮度切れ
      updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(bestFreshPriceYen([fresh, stale])).toBe(15000);
  });

  it("out_of_stock の offer は価格として使用しない", () => {
    const available = makeOffer({
      providerItemId: "available",
      priceMinor: 1500000,
      availability: "in_stock",
    });
    const oos = makeOffer({
      providerItemId: "oos",
      priceMinor: 800000, // 最安値だが在庫なし
      availability: "out_of_stock",
    });
    expect(bestFreshPriceYen([available, oos])).toBe(15000);
  });

  it("全て out_of_stock なら null", () => {
    const offers = [
      makeOffer({ providerItemId: "1", availability: "out_of_stock" }),
      makeOffer({ providerItemId: "2", availability: "out_of_stock" }),
    ];
    expect(bestFreshPriceYen(offers)).toBeNull();
  });

  it("空の offer リストは null", () => {
    expect(bestFreshPriceYen([])).toBeNull();
  });

  it("priceMinor が null の offer は無視", () => {
    const offers = [
      makeOffer({ providerItemId: "1", priceMinor: null }),
      makeOffer({ providerItemId: "2", priceMinor: 1200000 }),
    ];
    expect(bestFreshPriceYen(offers)).toBe(12000);
  });
});

// ──────────────────────────────────────────────
// hasAvailableOffer
// ──────────────────────────────────────────────

describe("hasAvailableOffer", () => {
  it("in_stock の offer がある場合は購入可", () => {
    const offers = [makeOffer({ providerItemId: "1", availability: "in_stock" })];
    const result = hasAvailableOffer(offers);
    expect(result.available).toBe(true);
    expect(result.policy.ctaVariant).toBe("primary");
  });

  it("全て out_of_stock なら購入不可", () => {
    const offers = [
      makeOffer({ providerItemId: "1", availability: "out_of_stock" }),
      makeOffer({ providerItemId: "2", availability: "out_of_stock" }),
    ];
    const result = hasAvailableOffer(offers);
    expect(result.available).toBe(false);
    expect(result.policy.ctaVariant).toBe("disabled");
  });

  it("鮮度切れの in_stock は無視", () => {
    const stale = makeOffer({
      providerItemId: "1",
      availability: "in_stock",
      updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = hasAvailableOffer([stale]);
    expect(result.available).toBe(false);
  });

  it("空の offer リストは購入不可", () => {
    const result = hasAvailableOffer([]);
    expect(result.available).toBe(false);
    expect(result.policy.ctaLabel).toBe("在庫確認");
  });

  it("複数 offer の場合、最も優先度の高い availability を返す", () => {
    const offers = [
      makeOffer({ providerItemId: "1", availability: "unknown" }),
      makeOffer({ providerItemId: "2", availability: "in_stock" }),
      makeOffer({ providerItemId: "3", availability: "low_stock" }),
    ];
    const result = hasAvailableOffer(offers);
    expect(result.available).toBe(true);
    expect(result.policy.ctaVariant).toBe("primary");
  });
});

// ──────────────────────────────────────────────
// Fallback policy
// ──────────────────────────────────────────────

describe("fallback policy", () => {
  it("keep_last: 鮮度のある offer なら維持", () => {
    const fresh = [makeOffer({ providerItemId: "1" })];
    expect(shouldKeepStaleOffer(fresh, "keep_last")).toBe(true);
  });

  it("keep_last: 鮮度切れの offer は非表示", () => {
    const stale = [
      makeOffer({
        providerItemId: "1",
        updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ];
    expect(shouldKeepStaleOffer(stale, "keep_last")).toBe(false);
  });

  it("hide: 常に非表示", () => {
    const fresh = [makeOffer({ providerItemId: "1" })];
    expect(shouldKeepStaleOffer(fresh, "hide")).toBe(false);
  });

  it("stale_mark: 明示的に stale 表示", () => {
    const stale = [
      makeOffer({
        providerItemId: "1",
        updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ];
    expect(shouldKeepStaleOffer(stale, "stale_mark")).toBe(true);
  });
});
