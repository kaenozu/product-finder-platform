import { CURATED_PANASONIC_HITACHI } from "./curated-panasonic";
import { CURATED_TIGER_MITSUBISHI } from "./curated-tiger";
import { CURATED_ZOJIRUSHI_GROUP } from "./curated-zojirushi";
import { CURATED_IRIS_OHYAMA } from "./curated-iris-ohyama";
import { CURATED_YAMAZEN } from "./curated-yamazen";
import type { CuratedRiceCookerRecord } from "./curated-types";

/** 全メーカー分の手動キュレーションデータ（出典: 各社公式サイト） */
export const CURATED_RICE_COOKERS: CuratedRiceCookerRecord[] = [
  ...CURATED_PANASONIC_HITACHI,
  ...CURATED_TIGER_MITSUBISHI,
  ...CURATED_ZOJIRUSHI_GROUP,
  ...CURATED_IRIS_OHYAMA,
  ...CURATED_YAMAZEN,
];

/** データ確認日（全レコードのsources.checkedAtもこれに統一） */
export const RICE_COOKER_CHECKED_AT = "2026-08-19";
