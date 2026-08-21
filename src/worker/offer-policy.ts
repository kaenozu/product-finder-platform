/**
 * Offer パイプラインの運用契約。
 *
 * - freshness: stale offer を「実売価格」として扱わない
 * - currency: priceMinor の意味を provider 横断で定義
 * - availability: CTA 可否のルール
 * - fallback: provider 障害時の挙動
 */
import type { ProductOffer, Availability } from "../shared/domain/types";

// ──────────────────────────────────────────────
// Freshness (鮮度)
// ──────────────────────────────────────────────

/**
 * offer の最大鮮度（ミリ秒）。
 * この時間を超えた offer は stale とみなされ、UI/API で「実売価格」として扱われない。
 * 7 日: 楽天等のECサイトでは価格・在庫が頻繁に変動するため。
 */
export const OFFER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * offer が鮮度条件を満たすか判定する。
 * @param offer - 判定する offer
 * @param now - 現在時刻（テスト用に注入可能）
 */
export function isOfferFresh(offer: ProductOffer, now: Date = new Date()): boolean {
  const updatedAt = new Date(offer.updatedAt).getTime();
  return now.getTime() - updatedAt <= OFFER_MAX_AGE_MS;
}

/**
 * offer リストから鮮度条件を満たすものだけを抽出する。
 */
export function filterFreshOffers(offers: ProductOffer[], now: Date = new Date()): ProductOffer[] {
  return offers.filter((o) => isOfferFresh(o, now));
}

// ──────────────────────────────────────────────
// Currency / priceMinor 契約
// ──────────────────────────────────────────────

/**
 * 対応通貨の minor unit 定義。
 * priceMinor は minor unit で表現される。
 * JPY: 1 priceMinor = 0.01 円（hundredths）。15,000円 = 1,500,000 priceMinor。
 * USD: 1 priceMinor = 0.01 ドル。$123.45 = 12,345 priceMinor。
 * EUR: 1 priceMinor = 0.01 ユーロ。€123.45 = 12,345 priceMinor。
 */
export const CURRENCY_MINOR_UNITS: Record<string, number> = {
  JPY: 100, // 1 priceMinor = 0.01 円 (hundredths of yen)
  USD: 100, // 1 priceMinor = 0.01 ドル (cent)
  EUR: 100, // 1 priceMinor = 0.01 ユーロ (cent)
};

/**
 * priceMinor を人間が読む金額文字列に変換する。
 * @param priceMinor - minor unit での価格
 * @param currency - ISO 4217 通貨コード
 * @returns 例: "12,345円", "$123.45"
 */
export function formatPrice(priceMinor: number, currency: string): string {
  const minorUnit = CURRENCY_MINOR_UNITS[currency] ?? 1;
  const major = priceMinor / minorUnit;

  switch (currency) {
    case "JPY":
      return `${major.toLocaleString("ja-JP")}円`;
    case "USD":
      return `$${major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "EUR":
      return `€${major.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    default:
      return `${major.toLocaleString()} ${currency}`;
  }
}

/**
 * priceMinor を円（major unit）に変換する。
 * JPY では 1:1。USD/EUR では minor unit で割る。
 * 将来外貨非対応とする場合、非 JPY はこの関数で reject できる。
 */
export function toYen(priceMinor: number, currency: string): number {
  const minorUnit = CURRENCY_MINOR_UNITS[currency] ?? 1;
  return priceMinor / minorUnit;
}

/**
 * 非 JPY offer を公開前に reject するかどうかの判定。
 * 現状は JPY のみ対応。将来外貨を追加する場合はここを更新。
 */
export function isSupportedCurrency(currency: string): boolean {
  return currency in CURRENCY_MINOR_UNITS;
}

// ──────────────────────────────────────────────
// Availability → CTA 可否
// ──────────────────────────────────────────────

/**
 * availability と CTA 可否の契約。
 * - in_stock: CTA 有効（「購入する」表示可）
 * - low_stock: CTA 有効（「購入する」表示可）
 * - out_of_stock: CTA 無効（「在庫なし」表示、購入不可）
 * - unknown: CTA 有条件的（「在庫確認」表示、購入ページへ誘導は可だが断定不可）
 */
export const CTA_POLICY: Record<
  Availability,
  { canPurchase: boolean; ctaLabel: string; ctaVariant: "primary" | "secondary" | "disabled" }
> = {
  in_stock: { canPurchase: true, ctaLabel: "購入する", ctaVariant: "primary" },
  low_stock: { canPurchase: true, ctaLabel: "購入する", ctaVariant: "secondary" },
  out_of_stock: { canPurchase: false, ctaLabel: "在庫なし", ctaVariant: "disabled" },
  unknown: { canPurchase: true, ctaLabel: "在庫確認", ctaVariant: "secondary" },
};

/**
 * offer の availability から CTA 方針を取得する。
 * availability が null の場合は unknown として扱う。
 */
export function getCtaPolicy(availability: string | null): (typeof CTA_POLICY)[Availability] {
  if (availability !== null && availability in CTA_POLICY) {
    return CTA_POLICY[availability as Availability];
  }
  return CTA_POLICY.unknown;
}

// ──────────────────────────────────────────────
// Offer quality (for scoring/explain)
// ──────────────────────────────────────────────

/**
 * 鮮度のある有効 offer の最安値（円）を返す。
 * - 鮮度切れの offer は無視
 * - out_of_stock の offer は価格として使用しない
 * - 非対応通貨は無視
 * - 全ての offer が条件を満たさない場合は null
 */
export function bestFreshPriceYen(offers: ProductOffer[], now: Date = new Date()): number | null {
  const candidates = offers
    .filter((o) => isOfferFresh(o, now))
    .filter((o) => o.availability !== "out_of_stock")
    .filter((o) => isSupportedCurrency(o.currency))
    .map((o) => o.priceMinor)
    .filter((p): p is number => p !== null && p > 0);

  if (candidates.length === 0) return null;
  // 最安値を円に変換（現状 JPY のみ対応だが、将来拡張可能）
  return Math.min(...candidates) / 100;
}

/**
 * 鮮度のある有効 offer から CTA 可否を判定する。
 * 全ての有効 offer が out_of_stock なら購入不可。
 */
export function hasAvailableOffer(
  offers: ProductOffer[],
  now: Date = new Date()
): { available: boolean; policy: (typeof CTA_POLICY)[Availability] } {
  const fresh = offers.filter((o) => isOfferFresh(o, now));

  if (fresh.length === 0) {
    return { available: false, policy: CTA_POLICY.unknown };
  }

  // 最も優先度の高い availability を返す
  // in_stock > low_stock > unknown > out_of_stock
  const priorities: Availability[] = ["in_stock", "low_stock", "unknown", "out_of_stock"];
  for (const avail of priorities) {
    if (fresh.some((o) => o.availability === avail)) {
      return { available: avail !== "out_of_stock", policy: CTA_POLICY[avail] };
    }
  }

  return { available: false, policy: CTA_POLICY.unknown };
}

// ──────────────────────────────────────────────
// Fallback policy
// ──────────────────────────────────────────────

/**
 * provider 取得失敗時の fallback policy。
 * - "keep_last": 直前の有効 offer を維持（デフォルト）
 * - "hide": 全て非表示にする
 * - "stale_mark": 古い offer を stale として明示的に表示
 */
export type FallbackPolicy = "keep_last" | "hide" | "stale_mark";

/**
 * API 障害時の直前有効 offer を維持するかどうかを判定。
 * - 直前の有効 offer が鮮度条件を満たすなら維持
 * - 鮮度を超過しているなら非表示
 */
export function shouldKeepStaleOffer(
  staleOffers: ProductOffer[],
  policy: FallbackPolicy,
  now: Date = new Date()
): boolean {
  if (policy === "hide") return false;
  if (policy === "stale_mark") return true; // 明示的に stale 表示
  // keep_last: 鮄度条件を満たすなら維持
  return filterFreshOffers(staleOffers, now).length > 0;
}
