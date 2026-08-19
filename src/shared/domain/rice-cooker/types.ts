import type { CatalogProduct } from "../types";

export type HeatingMethod = "micom" | "ih" | "pressure_ih";

/** 機能タグの統制語彙（商品データのfeaturesはこの集合から） */
export const FEATURE_TAGS = [
  "tacook", // 同時調理（おかずも一緒に炊ける）
  "steamer", // 蒸し調理
  "quick", // 早炊き
  "porridge", // おかゆ
  "slow_cook", // 煮込み
  "brown_rice", // 玄米
  "germinated", // 発芽玄米
  "sushi", // すし飯
  "eco", // エコ炊飯
  "cake", // ケーキ調理
] as const;

export type FeatureTag = (typeof FEATURE_TAGS)[number];

export type RiceCookerSpecs = {
  /** 炊飯容量（合） */
  capacityGou: number;
  heatingMethod: HeatingMethod;
  powerW: number | null;
  weightKg: number | null;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  /** 最大保温時間（時間） */
  keepWarmHours: number | null;
  /** 内釜（表示用文字列。例: 炭炊釜） */
  innerPot: string | null;
  features: FeatureTag[];
  /** 発売年 */
  releaseYear: number | null;
  /** 出典メタ（API表示用。スコア計算には使わない） */
  _sources?: Array<{ url: string; checkedAt: string }>;
};

export interface RiceCookerProduct extends CatalogProduct<RiceCookerSpecs> {
  categoryKey: "rice-cooker";
}

export type RiceCookerAnswerKey =
  "cookVolume" | "heating" | "budget" | "priority" | "useTacook" | "installWidth";

export type HeatingPreference = HeatingMethod | "any";
export type BudgetPreference = "under10k" | "10to20k" | "20to30k" | "over30k" | "any";
export type PriorityPreference = "taste" | "functions" | "keepwarm" | "ease" | "compact";

export interface RiceCookerCriteria {
  requiredCapacityGou: number;
  heatingPreference: HeatingPreference;
  budgetMaxYen: number | null;
  priority: PriorityPreference;
  useTacook: boolean;
  installWidthMm: number | null;
  answeredKeys: RiceCookerAnswerKey[];
}

export const BUDGET_LIMIT: Record<Exclude<BudgetPreference, "any">, number> = {
  under10k: 10_000,
  "10to20k": 20_000,
  "20to30k": 30_000,
  over30k: 50_000,
};

export const INSTALL_WIDTH_MM: Record<"under24" | "under25" | "under27", number> = {
  under24: 240,
  under25: 250,
  under27: 270,
};

export const CURRENT_YEAR = 2026;
