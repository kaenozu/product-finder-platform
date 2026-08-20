import type { CuratedRiceCookerRecord } from "./curated-types";

/**
 * 山善（Yamazen）炊飯ジャー 手動キュレーションデータ。
 * すべて山善公式サイト（book.yamazen.co.jp / yamazen.co.jp）の商品ページで検証済み。
 * 未確認項目は必ず null（推測値・AI推定値は使用しない）。
 */
export const CURATED_YAMAZEN: CuratedRiceCookerRecord[] = [
  {
    productId: "yamazen-yjn-e101",
    imageUrl: "https://book.yamazen.co.jp/photo/item/I00005709/1200/1200/max",
    manufacturer: "Yamazen",
    model: "YJN-E101",
    displayName: "IH炊飯器（5.5合炊き）",
    capacityGou: 5.5,
    heatingMethod: "ih",
    powerW: 1113,
    weightKg: 4.4,
    widthMm: 265,
    depthMm: 302,
    heightMm: 220,
    keepWarmHours: null,
    innerPot: null,
    features: ["brown_rice", "porridge"],
    releaseYear: null,
    referencePriceYen: null,
    availability: "unknown",
    sources: [
      { url: "https://book.yamazen.co.jp/product/detail/I00005709", checkedAt: "2026-08-19" },
    ],
  },
  {
    productId: "yamazen-yjs-cm102",
    imageUrl: "https://book.yamazen.co.jp/photo/item/I00009142/1200/1200/max",
    manufacturer: "Yamazen",
    model: "YJS-CM102",
    displayName: "キューブ型マイコンジャー炊飯器（5.5合炊き）",
    capacityGou: 5.5,
    heatingMethod: "micom",
    powerW: 615,
    weightKg: 3.9,
    widthMm: 210,
    depthMm: 246,
    heightMm: 268,
    keepWarmHours: null,
    innerPot: "厚釜（釜厚3.0mm）",
    features: ["quick", "brown_rice", "porridge", "eco"],
    releaseYear: 2025,
    referencePriceYen: null,
    availability: "unknown",
    sources: [
      { url: "https://book.yamazen.co.jp/product/detail/I00009142", checkedAt: "2026-08-19" },
      { url: "https://www.yamazen.co.jp/news/entry-2245.html", checkedAt: "2026-08-19" },
    ],
  },
  {
    productId: "yamazen-yjp-dm102",
    imageUrl: "https://book.yamazen.co.jp/photo/item/I00008817/1200/1200/max",
    manufacturer: "Yamazen",
    model: "YJP-DM102",
    displayName: "マイコン式炊飯器（5.5合炊き）",
    capacityGou: 5.5,
    heatingMethod: "micom",
    powerW: 635,
    weightKg: 3.3,
    widthMm: 245,
    depthMm: 301,
    heightMm: 208,
    keepWarmHours: null,
    innerPot: null,
    features: ["brown_rice"],
    releaseYear: null,
    referencePriceYen: null,
    availability: "unknown",
    sources: [
      { url: "https://book.yamazen.co.jp/product/detail/I00008817", checkedAt: "2026-08-19" },
    ],
  },
];
