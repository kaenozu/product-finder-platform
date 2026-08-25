import { describe, expect, it } from "vitest";
import type { CandidateResponse } from "../../src/client/lib/api";
import {
  bestOffer,
  formatDate,
  formatPrice,
  imageProxySrc,
  priceInfo,
} from "../../src/client/lib/product-display";
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

function makeCandidate(overrides: Partial<CandidateResponse> = {}): CandidateResponse {
  return {
    product: {
      productId: "test-product",
      manufacturer: "Test",
      model: "T-100",
      displayName: "テスト炊飯器",
      specs: {},
      referencePriceYen: null,
      availability: "in_stock",
      sourceUpdatedAt: "2026-06-15T12:00:00Z",
      ingestedAt: "2026-08-15T12:00:00Z",
      imageUrl: null,
    },
    sources: [],
    offers: [],
    reasons: [],
    weakPoints: [],
    scoreBreakdown: {},
    totalScore: 0,
    specItems: [],
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// 価格表示
// ──────────────────────────────────────────────

describe("priceInfo / formatPrice", () => {
  it("offers の最安値が参考価格より優先される", () => {
    const candidate = makeCandidate({
      offers: [
        makeOffer({ providerItemId: "1", priceMinor: 1500000 }),
        makeOffer({ providerItemId: "2", priceMinor: 1200000 }),
      ],
      product: { ...makeCandidate().product, referencePriceYen: 9800 },
    });
    const info = priceInfo(candidate);
    expect(info.kind).toBe("sale");
    expect(info.label).toBe("実売価格");
    expect(info.value).toBe(12000);
  });

  it("金額ありのとき toLocaleString で整形する", () => {
    expect(formatPrice({ kind: "sale", label: "実売価格", value: 12345 })).toBe(
      "実売価格 ¥12,345〜"
    );
    expect(formatPrice({ kind: "reference", label: "参考価格", value: 9800 })).toBe(
      "参考価格 ¥9,800〜"
    );
  });

  it("offers に有効な価格がなく referencePriceYen があれば参考価格", () => {
    const candidate = makeCandidate({
      offers: [makeOffer({ providerItemId: "1", priceMinor: null })],
      product: { ...makeCandidate().product, referencePriceYen: 9800 },
    });
    const info = priceInfo(candidate);
    expect(info).toEqual({ kind: "reference", label: "参考価格", value: 9800 });
  });

  it("priceMinor が 0 以下の offer は実売価格として扱わない", () => {
    const candidate = makeCandidate({
      offers: [
        makeOffer({ providerItemId: "1", priceMinor: 0 }),
        makeOffer({ providerItemId: "2", priceMinor: -500 }),
      ],
      product: { ...makeCandidate().product, referencePriceYen: 9800 },
    });
    expect(priceInfo(candidate)).toEqual({
      kind: "reference",
      label: "参考価格",
      value: 9800,
    });
  });

  it("referencePriceYen が null ならオープン価格扱い（価格情報なし）", () => {
    const info = priceInfo(makeCandidate());
    expect(info).toEqual({ kind: "unknown", label: "価格情報なし", value: null });
    expect(formatPrice(info)).toBe("価格情報なし");
  });
});

// ──────────────────────────────────────────────
// 最安オファー選択
// ──────────────────────────────────────────────

describe("bestOffer", () => {
  it("複数 offer から最安を選ぶ", () => {
    const candidate = makeCandidate({
      offers: [
        makeOffer({ providerItemId: "1", priceMinor: 1500000 }),
        makeOffer({ providerItemId: "2", priceMinor: 1200000 }),
        makeOffer({ providerItemId: "3", priceMinor: 1800000 }),
      ],
    });
    expect(bestOffer(candidate)?.providerItemId).toBe("2");
  });

  it("在庫ありがある場合、out_of_stock の安い offer は選ばない", () => {
    const candidate = makeCandidate({
      offers: [
        makeOffer({ providerItemId: "stocked", priceMinor: 1500000 }),
        makeOffer({ providerItemId: "oos", priceMinor: 800000, availability: "out_of_stock" }),
      ],
    });
    expect(bestOffer(candidate)?.providerItemId).toBe("stocked");
  });

  it("low_stock も在庫ありとして優先する", () => {
    const candidate = makeCandidate({
      offers: [
        makeOffer({ providerItemId: "low", priceMinor: 1300000, availability: "low_stock" }),
        makeOffer({ providerItemId: "oos", priceMinor: 800000, availability: "out_of_stock" }),
      ],
    });
    expect(bestOffer(candidate)?.providerItemId).toBe("low");
  });

  it("すべて out_of_stock なら購入CTAを出さない", () => {
    const candidate = makeCandidate({
      offers: [
        makeOffer({ providerItemId: "1", priceMinor: 1500000, availability: "out_of_stock" }),
        makeOffer({ providerItemId: "2", priceMinor: 1200000, availability: "out_of_stock" }),
      ],
    });
    expect(bestOffer(candidate)).toBeNull();
  });

  it("7日を超えたofferは価格・CTAから除外する", () => {
    const candidate = makeCandidate({
      offers: [
        makeOffer({
          providerItemId: "stale",
          priceMinor: 100,
          updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ],
      product: { ...makeCandidate().product, referencePriceYen: 9800 },
    });
    expect(bestOffer(candidate)).toBeNull();
    expect(priceInfo(candidate)).toEqual({ kind: "reference", label: "参考価格", value: 9800 });
  });

  it("priceMinor が null の offer は最後の候補になる", () => {
    const candidate = makeCandidate({
      offers: [
        makeOffer({ providerItemId: "no-price", priceMinor: null }),
        makeOffer({ providerItemId: "priced", priceMinor: 1200000 }),
      ],
    });
    expect(bestOffer(candidate)?.providerItemId).toBe("priced");
  });

  it("offer がない場合は null", () => {
    expect(bestOffer(makeCandidate())).toBeNull();
  });
});

// ──────────────────────────────────────────────
// 日付整形
// ──────────────────────────────────────────────

describe("formatDate", () => {
  it("ISO 文字列を 日本語形式に整形する", () => {
    // 正午指定でローカルタイムゾーンによる日ずれを避ける
    expect(formatDate("2026-06-15T12:00:00Z")).toBe("2026年6月15日");
  });

  it("undefined・空文字・不正値は null", () => {
    expect(formatDate(undefined)).toBeNull();
    expect(formatDate(null)).toBeNull();
    expect(formatDate("")).toBeNull();
    expect(formatDate("not-a-date")).toBeNull();
  });
});

// ──────────────────────────────────────────────
// 画像プロキシURL
// ──────────────────────────────────────────────

describe("imageProxySrc", () => {
  it("クエリ付きURLも encodeURIComponent でエスケープする", () => {
    expect(imageProxySrc("https://example.com/a.jpg?w=100&h=50")).toBe(
      "/img?url=https%3A%2F%2Fexample.com%2Fa.jpg%3Fw%3D100%26h%3D50"
    );
  });
});
