import type { CuratedRiceCookerRecord } from "./curated-types";

/**
 * アイリスオーヤマ（IRIS OHYAMA）炊飯ジャー 手動キュレーションデータ。
 * すべてアイリスオーヤマ公式サイト（irisohyama.co.jp）の商品ページで検証済み。
 * 未確認項目は必ず null（推測値・AI推定値は使用しない）。
 */
export const CURATED_IRIS_OHYAMA: CuratedRiceCookerRecord[] = [
  {
    productId: "iris-rc-msa50",
    manufacturer: "IRIS OHYAMA",
    model: "RC-MSA50",
    displayName: "マイコンジャー炊飯器 RC-MSA50",
    capacityGou: 5.5,
    heatingMethod: "micom",
    powerW: 650,
    weightKg: 3.0,
    widthMm: 239,
    depthMm: 301,
    heightMm: 209,
    keepWarmHours: null,
    innerPot: "極厚火釜（釜厚3.0mm）",
    features: ["quick", "brown_rice", "eco"],
    releaseYear: null,
    referencePriceYen: null,
    availability: "unknown",
    sources: [{ url: "https://www.irisohyama.co.jp/ricecooker/rc-msa/", checkedAt: "2026-08-19" }],
  },
  {
    productId: "iris-rc-ila50",
    manufacturer: "IRIS OHYAMA",
    model: "RC-ILA50",
    displayName: "IHジャー炊飯器 5.5合 RC-ILA50",
    capacityGou: 5.5,
    heatingMethod: "ih",
    powerW: 1040,
    weightKg: 3.3,
    widthMm: 250,
    depthMm: 295,
    heightMm: 201,
    keepWarmHours: null,
    innerPot: null,
    features: ["quick", "brown_rice", "porridge", "eco", "cake"],
    releaseYear: null,
    referencePriceYen: null,
    availability: "unknown",
    sources: [{ url: "https://www.irisohyama.co.jp/ricecooker/rc-ila50", checkedAt: "2026-08-19" }],
  },
];
