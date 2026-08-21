import type {
  AnswerRecord,
  HardMatchResult,
  ProductOffer,
  QualityGateReport,
  RecommendationReason,
  ScoreResult,
  SpecDisplayItem,
} from "../types";
import { BUDGET_BOUNDS, CURRENT_YEAR, INSTALL_WIDTH_MM } from "./types";
import { QUESTIONS, QUESTION_KEYS } from "./questions";
import { activeQuestionKeys } from "../flow";
import type {
  HeatingMethod,
  HeatingPreference,
  PriorityPreference,
  RiceCookerAnswerKey,
  RiceCookerCriteria,
  RiceCookerProduct,
} from "./types";

/** スコア内訳キー→ユーザー向け表示ラベル */
export const SCORE_LABELS: Record<string, string> = {
  fitScore: "容量との相性",
  heatingScore: "加熱方式",
  featureScore: "重視ポイント",
  budgetScore: "予算",
  freshnessScore: "モデルの新しさ",
};

/** 加熱方式の表示ラベル */
export const HEATING_LABELS: Record<HeatingMethod, string> = {
  micom: "マイコン",
  ih: "IH",
  pressure_ih: "圧力IH",
};

/** スコアの理論上の最大値（fit3 + heating2 + feature3 + budget2 + freshness1） */
export const MAX_SCORE = 11;

/** UI描画用のカテゴリ固有コピー */
export const COPY = {
  appTitle: "炊飯器選び診断",
  heroTitle: "あなたに合った炊飯器を、数分で見つける。",
  heroLead:
    "容量・加熱方式・予算など、普段の炊き方を数問答えるだけで、あなたに合った炊飯器を診断します。",
  benefits: [
    { title: "かんたん数問", text: "6問の質問に答えるだけ" },
    { title: "相性をスコア化", text: "条件との一致度でランキング" },
    { title: "スペックで比較", text: "容量・加熱方式・スペックを一覧で" },
  ],
  note: "診断は目安です。公式スペックに基づき、購入時は最新の価格・在庫をご確認ください。",
  resultTitle: "あなたに合う炊飯器",
  resultNoMatchTitle: "条件に合う炊飯器が見つかりませんでした",
} as const;

/** 品質ゲート: 物理的な範囲チェック（信頼できる値のみ許容） */
function rangeGate(products: RiceCookerProduct[]): QualityGateReport {
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

/** 品質ゲート: 診断が機能する最低限のラインナップ（加熱方式・メーカー） */
function fixtureGate(products: RiceCookerProduct[]): QualityGateReport {
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

/** カテゴリ固有の品質ゲート（汎用パイプラインから呼ばれる） */
export function qualityGates(products: RiceCookerProduct[]): QualityGateReport[] {
  return [rangeGate(products), fixtureGate(products)];
}

/** 回帰テスト用の代表回答（hard-match が非空を返すことの検証に使用） */
export const REGRESSION_SAMPLE_ANSWERS: AnswerRecord[] = [
  { cookVolume: "3", heating: "any" },
  { cookVolume: "5.5", heating: "ih" },
  { cookVolume: "5.5", heating: "pressure_ih", installWidth: "under27" },
];

/**
 * 回答条件ごとに到達可能な最大スコア。
 * 「加熱方式こだわらない」「予算こだわらない」は最大1.5/2点なので、
 * これで正規化することで「一致度%」が回答内容によっては100%に届かない問題を解消する。
 */
export function attainableMaxScore(criteria: RiceCookerCriteria): number {
  const heating = criteria.heatingPreference === "any" ? 1.5 : 2;
  const budget = criteria.budgetYen.min === null && criteria.budgetYen.max === null ? 1.5 : 2;
  return round1(3 + heating + 3 + budget + 1);
}

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
    budgetYen:
      budget !== undefined
        ? BUDGET_BOUNDS[budget as keyof typeof BUDGET_BOUNDS]
        : { min: null, max: null },
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

/** offer の鮮度上限（ミリ秒）。7 日。 */
export const OFFER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 実効価格（円）: 鮮度のある有効 offer の最安値を最優先し、なければカタログ参考価格、それもなければnull。
 *
 * - 鮮度切れ（7日超）の offer は「実売価格」として扱わない
 * - out_of_stock の offer は価格として使用しない
 * - priceMinor は JPY で 1:1（1 priceMinor = 1 円）
 * - 価格データが無い間は予算スコアを中立に保ち、不当に上下させない
 */
function effectivePriceYen(
  product: RiceCookerProduct,
  offers?: ProductOffer[],
  now: Date = new Date()
): number | null {
  if (offers && offers.length > 0) {
    const cutoff = now.getTime() - OFFER_MAX_AGE_MS;
    const prices = offers
      .filter((o) => new Date(o.updatedAt).getTime() >= cutoff)
      .filter((o) => o.availability !== "out_of_stock")
      .map((o) => o.priceMinor)
      .filter((p): p is number => p !== null && p > 0);
    if (prices.length > 0) return Math.min(...prices) / 100;
  }
  return product.referencePriceYen;
}

/**
 * スコアリング（ソフト条件）。fit + preference + feature + budget + freshness の合算。
 * 同点時はengine側でproduct_idの安定ソートを行う。
 */
export function score(
  product: RiceCookerProduct,
  criteria: RiceCookerCriteria,
  offers?: ProductOffer[]
): ScoreResult {
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

  // budgetScore: 実効価格（実売offer最安値→参考価格の順）と予算
  breakdown.budgetScore = budgetScore(product, criteria, offers);

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
    case "taste": {
      // 加熱方式をベースに、多彩な炊飯メニュー（玄米・発芽玄米）の対応で加点。最大3
      const base =
        product.specs.heatingMethod === "pressure_ih"
          ? 3
          : product.specs.heatingMethod === "ih"
            ? 2
            : 1;
      const menu = features.has("germinated") || features.has("brown_rice") ? 1 : 0;
      return Math.min(3, base + menu);
    }
    case "keepwarm": {
      const hours = product.specs.keepWarmHours;
      return hours !== null && hours >= 12 ? 3 : hours !== null && hours >= 8 ? 2 : 1;
    }
    case "ease": {
      // 軽さ（重量）を評価の主軸とする。本体が軽いほど取り回しやすい
      const weight = product.specs.weightKg;
      return weight === null ? 1 : weight <= 3.5 ? 3 : weight <= 5 ? 2 : 1;
    }
    case "compact": {
      const width = product.specs.widthMm;
      return width !== null && width <= 240 ? 3 : width !== null && width <= 250 ? 2 : 1;
    }
  }
}

function budgetScore(
  product: RiceCookerProduct,
  criteria: RiceCookerCriteria,
  offers?: ProductOffer[]
): number {
  const { min, max } = criteria.budgetYen;
  if (min === null && max === null) return 1.5; // 予算制約なし
  const price = effectivePriceYen(product, offers);
  if (price === null) return 1.5; // 価格不明は中立（不当に上下させない）
  if (max !== null && price > max) return price <= max * 1.2 ? 1 : 0;
  if (min !== null && price < min) return price >= min * 0.8 ? 1 : 0;
  return 2;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 商品カードに表示するスペック項目（カテゴリ固有の単位・文言） */
export function formatSpecs(product: RiceCookerProduct): SpecDisplayItem[] {
  const items: SpecDisplayItem[] = [
    { key: "capacity", label: "容量", value: `${product.specs.capacityGou}合` },
    { key: "heating", label: "加熱方式", value: HEATING_LABELS[product.specs.heatingMethod] },
  ];
  if (product.specs.widthMm !== null) {
    items.push({
      key: "width",
      label: "幅",
      value: `${(product.specs.widthMm / 10).toFixed(1)}cm`,
    });
  }
  if (product.specs.weightKg !== null) {
    items.push({ key: "weight", label: "重量", value: `約${product.specs.weightKg}kg` });
  }
  return items;
}

/** 推薦理由の生成（reasonCode → 表示文言） */
export function explain(
  product: RiceCookerProduct,
  criteria: RiceCookerCriteria,
  offers?: ProductOffer[]
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

  if (criteria.priority === "ease" && product.specs.weightKg !== null) {
    reasons.push({
      code: "ease_lightweight",
      text: `本体約${product.specs.weightKg}kgと軽量で取り回しやすい`,
    });
  }

  if (product.specs.releaseYear !== null && CURRENT_YEAR - product.specs.releaseYear <= 1) {
    reasons.push({
      code: "fresh_model",
      text: "新しいモデル（発売年" + product.specs.releaseYear + "）",
    });
  }

  const { min, max } = criteria.budgetYen;
  const price = effectivePriceYen(product, offers);
  if ((min !== null || max !== null) && price !== null) {
    if (max !== null && price > max && price <= max * 1.2) {
      reasons.push({ code: "price_near_budget", text: "価格が予算の上限に近い" });
    } else if (max !== null && price > max) {
      reasons.push({
        code: "price_over_budget",
        text: `価格が予算の上限（${max.toLocaleString()}円）を超える`,
      });
    } else if (min !== null && price < min) {
      reasons.push({
        code: "price_below_budget",
        text: `価格が予算の目安（${min.toLocaleString()}円以上）を下回る`,
      });
    } else {
      reasons.push({ code: "budget_fit", text: `価格が予算内（${price.toLocaleString()}円）` });
    }
  }

  return reasons;
}

/** 惜しい点の生成（スコア/条件から外れる点を正直に提示） */
export function weakPoints(
  product: RiceCookerProduct,
  criteria: RiceCookerCriteria,
  offers?: ProductOffer[]
): RecommendationReason[] {
  const points: RecommendationReason[] = [];
  const diff = product.specs.capacityGou - criteria.requiredCapacityGou;
  const features = new Set(product.specs.features);

  if (diff > 2) {
    points.push({
      code: "capacity_large",
      text: `容量が${product.specs.capacityGou}合と、必要な${criteria.requiredCapacityGou}合より大きめ（${diff}合の余裕）`,
    });
  }

  if (
    criteria.heatingPreference !== "any" &&
    product.specs.heatingMethod !== criteria.heatingPreference
  ) {
    const actual =
      product.specs.heatingMethod === "pressure_ih"
        ? "圧力IH"
        : product.specs.heatingMethod === "ih"
          ? "IH"
          : "マイコン";
    const wanted =
      criteria.heatingPreference === "pressure_ih"
        ? "圧力IH"
        : criteria.heatingPreference === "ih"
          ? "IH"
          : "マイコン";
    points.push({
      code: "heating_mismatch",
      text: `加熱方式が希望（${wanted}）と異なり${actual}です`,
    });
  }

  if (criteria.priority === "functions" && criteria.useTacook && !features.has("tacook")) {
    points.push({ code: "no_tacook", text: "希望の同時調理（おかず同時炊き）に対応していません" });
  }

  if (
    criteria.priority === "keepwarm" &&
    product.specs.keepWarmHours !== null &&
    product.specs.keepWarmHours < 8
  ) {
    points.push({
      code: "keepwarm_short",
      text: `保温は${product.specs.keepWarmHours}時間と、長時間保温重視には物足りません`,
    });
  }

  if (
    criteria.priority === "compact" &&
    product.specs.widthMm !== null &&
    product.specs.widthMm > 250
  ) {
    points.push({
      code: "wide",
      text: `幅${product.specs.widthMm}mmと、コンパクト重視には大きめです`,
    });
  }

  if (
    criteria.priority === "ease" &&
    product.specs.weightKg !== null &&
    product.specs.weightKg > 5
  ) {
    points.push({
      code: "heavy",
      text: `本体約${product.specs.weightKg}kgと、取り回しにやや重さを感じます`,
    });
  }

  if (product.specs.releaseYear !== null && CURRENT_YEAR - product.specs.releaseYear >= 3) {
    points.push({
      code: "old_model",
      text: `発売から${CURRENT_YEAR - product.specs.releaseYear}年経過したモデルです`,
    });
  }

  const { min, max } = criteria.budgetYen;
  const price = effectivePriceYen(product, offers);
  if ((min !== null || max !== null) && price !== null && max !== null && price > max) {
    points.push({
      code: "price_over",
      text: `価格が予算の上限（${max.toLocaleString()}円）を超えています`,
    });
  }

  return points;
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
