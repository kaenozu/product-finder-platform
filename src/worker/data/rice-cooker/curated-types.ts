import type { Availability } from "../../../shared/domain/types";
import type { FeatureTag, HeatingMethod } from "../../../shared/domain/rice-cooker/types";

/** 出典（公式ページURL + 確認日） */
export interface CuratedSourceRef {
  url: string;
  checkedAt: string;
}

/**
 * 手動キュレーションの生レコード。
 * 未確認の数値は必ず null にする（推測値・AI推定値を入れない）。
 */
export interface CuratedRiceCookerRecord {
  productId: string;
  manufacturer: string;
  model: string;
  displayName: string;
  capacityGou: number;
  heatingMethod: HeatingMethod;
  powerW: number | null;
  weightKg: number | null;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  keepWarmHours: number | null;
  innerPot: string | null;
  features: FeatureTag[];
  releaseYear: number | null;
  referencePriceYen: number | null;
  availability?: Availability;
  sources: CuratedSourceRef[];
}
