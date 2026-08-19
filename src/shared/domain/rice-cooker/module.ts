import type { AnswerRecord, HardMatchResult, RecommendationReason, ScoreResult } from "../types";
import { BUDGET_LIMIT, CURRENT_YEAR, INSTALL_WIDTH_MM } from "./types";
import { QUESTIONS, QUESTION_KEYS } from "./questions";
import { activeQuestionKeys } from "../flow";
import type {
  HeatingPreference,
  PriorityPreference,
  RiceCookerAnswerKey,
  RiceCookerCriteria,
  RiceCookerProduct,
} from "./types";

function parseFloatOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** 回答レコードから型付きcriteriaを生成する（プロンプト§7のderiveCriteria） */
export function deriveCriteria(answers: AnswerRecord): RiceCookerCriteria {
  const cookVolume = parseFloatOrNull(answers.cookVolume) ?? 3;
  const budget = answers.budget;
  const heating = (answers.heating ?? "any") as HeatingPreference;
  const priority = (answers.priority ?? "taste") as PriorityPreference;
  const useTacook = answers.useTacook === "yes";
  const installWidth =
    answers.installWidth === "free" || answers.installWidth === undefined
      ? null
      : (INSTALL_WIDTH_MM[answers.installWidth as keyof typeof INSTALL_WIDTH_MM] ?? null);

  const answeredKeys = QUESTION_KEYS.filter((key) => answers[key] !== undefined);

  return {
    requiredCapacityGou: cookVolume,
    heatingPreference: heating,
    budgetMaxYen:
      budget !== undefined && budget !== "any"
        ? BUDGET_LIMIT[budget as keyof typeof BUDGET_LIMIT]
        : null,
    priority,
    useTacook,
    installWidthMm: installWidth,
    answeredKeys,
  };
}

/** 途中推薦が可能か（容量などのハード条件が確定し、追加の条件が1つ以上ある時） */
export function canShowPartialResult(answers: AnswerRecord, criteria: RiceCookerCriteria): boolean {
  const answered = criteria.answeredKeys.length;
  return answered >= 2;
}

/**
 * ハード条件の判定。1つでも満たさない商品は推薦候補へ出さない。
 * - 炊飯容量が必要量以上
 * - 設置幅が収まる（回答がある場合）
 * - 在庫がある
 */
export function hardMatch(
  product: RiceCookerProduct,
  criteria: RiceCookerCriteria
): HardMatchResult {
  const reasons: string[] = [];

  if (product.specs.capacityGou < criteria.requiredCapacityGou) {
    reasons.push(
      `炊飯容量${product.specs.capacityGou}合が、必要な${criteria.requiredCapacityGou}合を下回る`
    );
  }

  if (criteria.installWidthMm !== null) {
    if (product.specs.widthMm === null) {
      reasons.push("設置寸法（幅）が不明");
    } else if (product.specs.widthMm > criteria.installWidthMm) {
      reasons.push(
        `幅${product.specs.widthMm}mmが設置スペース（${criteria.installWidthMm}mm）に入らない`
      );
    }
  }

  if (product.availability === "out_of_stock") {
    reasons.push("在庫なし");
  }

  return { pass: reasons.length === 0, reasons };
}

/**
 * スコアリング（ソフト条件）。fit + preference + feature + budget + freshness の合算。
 * 同点時はengine側でproduct_idの安定ソートを行う。
 */
export function score(product: RiceCookerProduct, criteria: RiceCookerCriteria): ScoreResult {
  const breakdown: Record<string, number> = {};

  // fitScore: 容量の過不足
  const diff = product.specs.capacityGou - criteria.requiredCapacityGou;
  breakdown.fitScore =
    diff === 0 ? 3 : diff > 0 && diff <= 2 ? 2.5 : diff > 2 && diff <= 4 ? 2 : diff > 4 ? 1 : 0;

  // heatingScore: 加熱方式の一致
  breakdown.heatingScore =
    criteria.heatingPreference === "any"
      ? 1.5
      : product.specs.heatingMethod === criteria.heatingPreference
        ? 2
        : 0.5;

  // featureScore: 重視ポイントへの適合
  breakdown.featureScore = featureScore(product, criteria);

  // budgetScore: 参考価格と予算
  breakdown.budgetScore = budgetScore(product, criteria);

  // freshnessScore: 発売年が新しいほど高く（不明なら中立）
  const age = product.specs.releaseYear === null ? null : CURRENT_YEAR - product.specs.releaseYear;
  breakdown.freshnessScore =
    age === null ? 0.6 : age <= 0 ? 1 : age === 1 ? 0.8 : age === 2 ? 0.6 : 0.4;

  const score = round1(
    breakdown.fitScore +
      breakdown.heatingScore +
      breakdown.featureScore +
      breakdown.budgetScore +
      breakdown.freshnessScore
  );

  return { score, breakdown };
}

function featureScore(product: RiceCookerProduct, criteria: RiceCookerCriteria): number {
  const features = new Set(product.specs.features);
  switch (criteria.priority) {
    case "functions": {
      if (criteria.useTacook && !features.has("tacook")) return 0;
      let n = 0;
      for (const tag of ["tacook", "steamer", "quick"] as const) {
        if (features.has(tag)) n += 1;
      }
      return Math.min(3, n);
    }
    case "taste":
      return product.specs.heatingMethod === "pressure_ih"
        ? 3
        : product.specs.heatingMethod === "ih"
          ? 2
          : 1;
    case "keepwarm": {
      const hours = product.specs.keepWarmHours;
      return hours !== null && hours >= 12 ? 3 : hours !== null && hours >= 8 ? 2 : 1;
    }
    case "ease": {
      const weight = product.specs.weightKg;
      return (
        (product.specs.heatingMethod === "micom" ? 2 : 1) +
        (weight !== null && weight <= 3.5 ? 1 : 0)
      );
    }
    case "compact": {
      const width = product.specs.widthMm;
      return width !== null && width <= 240 ? 3 : width !== null && width <= 250 ? 2 : 1;
    }
  }
}

function budgetScore(product: RiceCookerProduct, criteria: RiceCookerCriteria): number {
  const budget = criteria.budgetMaxYen;
  const price = product.referencePriceYen;
  if (budget === null || price === null) return 1.5;
  if (price <= budget) return 2;
  if (price <= budget * 1.2) return 1;
  return 0;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 推薦理由の生成（reasonCode → 表示文言） */
export function explain(
  product: RiceCookerProduct,
  criteria: RiceCookerCriteria
): RecommendationReason[] {
  const reasons: RecommendationReason[] = [];
  const diff = product.specs.capacityGou - criteria.requiredCapacityGou;
  const features = new Set(product.specs.features);

  if (diff >= 0) {
    reasons.push({
      code: "capacity_fit",
      text:
        diff === 0
          ? `炊飯容量${product.specs.capacityGou}合が、必要な${criteria.requiredCapacityGou}合とぴったり`
          : `炊飯容量${product.specs.capacityGou}合が、必要な${criteria.requiredCapacityGou}合を満たす（${diff}合の余裕）`,
    });
  }

  if (
    criteria.heatingPreference !== "any" &&
    product.specs.heatingMethod === criteria.heatingPreference
  ) {
    const label =
      product.specs.heatingMethod === "pressure_ih"
        ? "圧力IH"
        : product.specs.heatingMethod === "ih"
          ? "IH"
          : "マイコン";
    reasons.push({ code: "heating_match", text: `希望の加熱方式（${label}）に一致` });
  }

  if (features.has("tacook")) {
    reasons.push({ code: "feature_tacook", text: "同時調理（おかずを一緒に炊ける）に対応" });
  }
  if (features.has("steamer")) {
    reasons.push({ code: "feature_steamer", text: "蒸し調理に対応" });
  }

  if (
    criteria.priority === "keepwarm" &&
    product.specs.keepWarmHours !== null &&
    product.specs.keepWarmHours >= 8
  ) {
    reasons.push({
      code: "keepwarm_long",
      text: `${product.specs.keepWarmHours}時間の長時間保温に対応`,
    });
  }

  if (
    criteria.priority === "compact" &&
    product.specs.widthMm !== null &&
    product.specs.widthMm <= 250
  ) {
    reasons.push({ code: "compact", text: `幅${product.specs.widthMm}mmのコンパクト設計` });
  }

  if (criteria.priority === "taste" && product.specs.heatingMethod === "pressure_ih") {
    reasons.push({ code: "taste_pressure", text: "圧力炊飯でふっくらとした炊き上がり" });
  }

  if (product.specs.releaseYear !== null && CURRENT_YEAR - product.specs.releaseYear <= 1) {
    reasons.push({
      code: "fresh_model",
      text: "新しいモデル（発売年" + product.specs.releaseYear + "）",
    });
  }

  const budget = criteria.budgetMaxYen;
  const price = product.referencePriceYen;
  if (budget !== null && price !== null) {
    if (price <= budget) {
      reasons.push({ code: "budget_fit", text: `参考価格が予算内（${price.toLocaleString()}円）` });
    } else if (price <= budget * 1.2) {
      reasons.push({ code: "price_near_budget", text: "参考価格が予算の上限に近い" });
    }
  }

  return reasons;
}

/** 未回答のうち、現在の分岐パス上にありcriteria導出に影響する質問キー（警告表示用） */
export function unansweredImportantKeys(answers: AnswerRecord): RiceCookerAnswerKey[] {
  const active = activeQuestionKeys(QUESTIONS, answers);
  return active.filter((key) => answers[key] === undefined) as RiceCookerAnswerKey[];
}

/** 回答内容とカタログに基づく追加の警告（機能要求がカタログに満たせない場合など） */
export function buildWarnings(
  answers: AnswerRecord,
  criteria: RiceCookerCriteria,
  products: RiceCookerProduct[]
): string[] {
  const warnings: string[] = [];
  if (criteria.priority === "functions" && criteria.useTacook) {
    const hasTacook = products.some((p) => p.specs.features.includes("tacook"));
    if (!hasTacook) {
      warnings.push(
        "「同時調理」対応の商品が現在のカタログにありません。ほかの重視項目に変更すると候補が増えます（条件は自動では緩和しません）。"
      );
    }
  }
  return warnings;
}
