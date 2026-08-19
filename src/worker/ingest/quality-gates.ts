import type { CatalogProduct } from "../../shared/domain/types";
import type { RiceCookerProduct } from "../../shared/domain/rice-cooker/types";

/** プロンプト§6の品質ゲート。失敗理由は日本語で返す */
export interface QualityGateResult {
  name: string;
  pass: boolean;
  message: string;
}

export const MIN_PRODUCTS = 30;
export const MAX_PRODUCTS = 1_000;
/** 前回公開版と比べてこの割合以上減っていたらデータ欠損とみなす */
export const MAX_REGRESSION_RATIO = 0.1;

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

/** gate 4: range — 物理的な範囲チェック（信頼できる値のみ許容） */
export function rangeGate(products: RiceCookerProduct[]): QualityGateResult {
  const issues: string[] = [];
  for (const p of products) {
    const s = p.specs;
    if (s.capacityGou < 0.5 || s.capacityGou > 12)
      issues.push(`${p.productId}: 容量${s.capacityGou}合`);
    if (s.powerW !== null && (s.powerW < 100 || s.powerW > 3000))
      issues.push(`${p.productId}: 消費電力${s.powerW}W`);
    if (s.widthMm !== null && (s.widthMm < 150 || s.widthMm > 500))
      issues.push(`${p.productId}: 幅${s.widthMm}mm`);
    if (s.weightKg !== null && (s.weightKg < 1 || s.weightKg > 30))
      issues.push(`${p.productId}: 質量${s.weightKg}kg`);
    if (s.keepWarmHours !== null && (s.keepWarmHours < 1 || s.keepWarmHours > 72))
      issues.push(`${p.productId}: 保温${s.keepWarmHours}h`);
    if (s.releaseYear !== null && (s.releaseYear < 2000 || s.releaseYear > 2100))
      issues.push(`${p.productId}: 発売年${s.releaseYear}`);
  }
  return {
    name: "range",
    pass: issues.length === 0,
    message:
      issues.length === 0 ? "全スペックが物理的な範囲内" : `範囲外スペック: ${issues.join(", ")}`,
  };
}

/** gate 5: fixture — 診断が機能する最低限のラインナップ（加熱方式・メーカー） */
export function fixtureGate(products: RiceCookerProduct[]): QualityGateResult {
  const methods = new Set(products.map((p) => p.specs.heatingMethod));
  const manufacturers = new Set(products.map((p) => p.manufacturer));
  const missing: string[] = [];
  for (const m of ["micom", "ih", "pressure_ih"] as const) {
    if (!methods.has(m)) missing.push(`加熱方式:${m}`);
  }
  if (manufacturers.size < 3) missing.push(`メーカー数が3未満（${manufacturers.size}）`);
  const pass = missing.length === 0;
  return {
    name: "fixture",
    pass,
    message: pass
      ? `ラインナップ充足（3加熱方式 / ${manufacturers.size}メーカー）`
      : `ラインナップ不足: ${missing.join(", ")}`,
  };
}

/**
 * gate 6: hard-condition-regression —
 * 代表的な診断条件で必ず1件以上マッチすること（カタログの劣化を防ぐ）
 */
export function hardConditionRegressionGate(
  products: RiceCookerProduct[],
  hardMatch: (p: RiceCookerProduct, criteria: unknown) => { pass: boolean },
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
