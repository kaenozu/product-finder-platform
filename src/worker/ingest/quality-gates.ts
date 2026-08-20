import type { CatalogProduct, QualityGateReport } from "../../shared/domain/types";

/** プロンプト§6の品質ゲート。失敗理由は日本語で返す */
export type QualityGateResult = QualityGateReport;

export const MIN_PRODUCTS = 30;
export const MAX_PRODUCTS = 1_000;
/** 前回公開版と比べてこの割合以上減っていたらデータ欠損とみなす */
export const MAX_REGRESSION_RATIO = 0.1;
/** ソース更新日時がこの日数を超えて古い場合は fresh でないとみなす */
export const MAX_SOURCE_AGE_DAYS = 90;

/** gate 1: schema — zodで全レコード検証済み（rejected=0）であること */
export function schemaGate(rejectedCount: number): QualityGateResult {
  return {
    name: "schema",
    pass: rejectedCount === 0,
    message:
      rejectedCount === 0
        ? "全レコードがスキーマ検証を通過"
        : `不正レコードが ${rejectedCount} 件ある`,
  };
}

/** gate 2: count — 30〜1000商品の範囲 */
export function countGate(count: number): QualityGateResult {
  const pass = count >= MIN_PRODUCTS && count <= MAX_PRODUCTS;
  return {
    name: "count",
    pass,
    message: pass
      ? `商品数 ${count}（要件 ${MIN_PRODUCTS}〜${MAX_PRODUCTS}）`
      : `商品数 ${count} が要件（${MIN_PRODUCTS}〜${MAX_PRODUCTS}）を外れている`,
  };
}

/** gate 3: uniqueness — productId が一意 */
export function uniquenessGate(products: CatalogProduct[]): QualityGateResult {
  const ids = new Set(products.map((p) => p.productId));
  const pass = ids.size === products.length;
  return {
    name: "uniqueness",
    pass,
    message: pass
      ? `productId 一意（${ids.size}件）`
      : `重複する productId がある（${products.length - ids.size}件）`,
  };
}

/**
 * gate 4: range — 物理的な範囲チェック（カテゴリ固有。module.qualityGates が提供）
 * gate 5: fixture — 診断が機能する最低限のラインナップ（カテゴリ固有。module.qualityGates が提供）
 */

/**
 * gate 6: hard-condition-regression —
 * 代表的な診断条件で必ず1件以上マッチすること（カタログの劣化を防ぐ）
 */
export function hardConditionRegressionGate(
  products: CatalogProduct[],
  hardMatch: (p: CatalogProduct, criteria: unknown) => { pass: boolean },
  sampleCriteria: unknown[]
): QualityGateResult {
  const fails: string[] = [];
  sampleCriteria.forEach((criteria, i) => {
    const matched = products.filter((p) => hardMatch(p, criteria).pass);
    if (matched.length === 0) fails.push(`条件セット#${i + 1}でマッチ0件`);
  });
  return {
    name: "hard-condition-regression",
    pass: fails.length === 0,
    message: fails.length === 0 ? "代表的条件すべてで候補あり" : `候補なし: ${fails.join(", ")}`,
  };
}

/** gate 8: freshness — ソース更新日時が古すぎない（古いデータを再公開しない） */
export function freshnessGate(products: CatalogProduct[], now: Date): QualityGateResult {
  const latest = products.reduce<string | null>((max, p) => {
    if (max === null || p.sourceUpdatedAt > max) return p.sourceUpdatedAt;
    return max;
  }, null);
  if (latest === null) {
    return { name: "freshness", pass: false, message: "更新日時不明の商品しかない" };
  }
  const ageDays = (now.getTime() - new Date(latest).getTime()) / 86_400_000;
  const pass = ageDays <= MAX_SOURCE_AGE_DAYS;
  return {
    name: "freshness",
    pass,
    message: pass
      ? `最新更新 ${latest.slice(0, 10)}（${Math.floor(ageDays)}日前）`
      : `データが古い（最新更新 ${latest.slice(0, 10)}、${Math.floor(ageDays)}日前）`,
  };
}

/** gate 7: version — 前回公開版と比べて大幅な減少がない */
export function versionRegressionGate(
  newCount: number,
  previousActiveCount: number | null
): QualityGateResult {
  if (previousActiveCount === null) {
    return { name: "version", pass: true, message: "初回公開（比較対象なし）" };
  }
  const minAllowed = Math.ceil(previousActiveCount * (1 - MAX_REGRESSION_RATIO));
  const pass = newCount >= minAllowed;
  return {
    name: "version",
    pass,
    message: pass
      ? `商品数 ${newCount}（前回 ${previousActiveCount}、${MAX_REGRESSION_RATIO * 100}%減まで許容）`
      : `商品数が前回 ${previousActiveCount} から ${newCount} へ大幅減少`,
  };
}
