import type { ProductOffer } from "../../shared/domain/types";
import type { CandidateResponse } from "./api";

// Keep client offer selection aligned with the Worker offer contract (#16).
// Offers older than seven days must not be presented as a current sale price.
const OFFER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isFreshOffer(offer: ProductOffer, now = Date.now()): boolean {
  const updatedAt = new Date(offer.updatedAt).getTime();
  return Number.isFinite(updatedAt) && now >= updatedAt && now - updatedAt <= OFFER_MAX_AGE_MS;
}

function usableOffers(candidate: CandidateResponse): ProductOffer[] {
  return candidate.offers.filter(
    (offer) =>
      isFreshOffer(offer) &&
      offer.currency === "JPY" &&
      offer.availability !== "out_of_stock"
  );
}

/** 商品画像は Worker の /img プロキシを経由して取得する
 * （一部メーカーの画像サーバーがブラウザからの直リンクをブロックするため） */
export function imageProxySrc(imageUrl: string): string {
  return `/img?url=${encodeURIComponent(imageUrl)}`;
}

export type PriceInfo =
  | { kind: "sale"; label: "実売価格"; value: number }
  | { kind: "reference"; label: "参考価格"; value: number }
  | { kind: "unknown"; label: "価格情報なし"; value: null };

export function priceInfo(candidate: CandidateResponse): PriceInfo {
  const prices = usableOffers(candidate)
    .map((o) => o.priceMinor)
    .filter((p): p is number => p !== null && p > 0);
  if (prices.length > 0) {
    return { kind: "sale", label: "実売価格", value: Math.min(...prices) / 100 };
  }
  if (candidate.product.referencePriceYen !== null) {
    return {
      kind: "reference",
      label: "参考価格",
      value: candidate.product.referencePriceYen,
    };
  }
  return { kind: "unknown", label: "価格情報なし", value: null };
}

export function formatPrice(info: PriceInfo): string {
  return info.value === null
    ? info.label
    : `${info.label} ¥${info.value.toLocaleString("ja-JP")}〜`;
}

/** 購入CTAの最優先オファー: 鮮度のある在庫あり→最安値順。無効なofferは選ばない */
export function bestOffer(candidate: CandidateResponse): ProductOffer | null {
  const offers = usableOffers(candidate);
  if (offers.length === 0) return null;
  const inStock = offers.filter(
    (o) => o.availability === "in_stock" || o.availability === "low_stock"
  );
  const pool = inStock.length > 0 ? inStock : offers;
  return pool.reduce((min: (typeof pool)[number] | null, o) => {
    if (min === null) return o;
    const a = o.priceMinor ?? Number.POSITIVE_INFINITY;
    const b = min.priceMinor ?? Number.POSITIVE_INFINITY;
    return a < b ? o : min;
  }, null);
}

export function formatDate(value: string | undefined | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
