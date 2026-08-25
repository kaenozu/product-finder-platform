import type {
  AnswerRecord,
  CatalogProduct,
  CategoryModule,
  HardMatchResult,
  ProductOffer,
  RecommendationReason,
} from "./types";
import { activeQuestionKeys } from "./flow";

export const MAX_CANDIDATES = 5;

export interface Candidate<P extends CatalogProduct> {
  product: P;
  offers: ProductOffer[];
  reasons: RecommendationReason[];
  weakPoints: RecommendationReason[];
  scoreBreakdown: Record<string, number>;
  totalScore: number;
}

export interface RecommendationResult<C, P extends CatalogProduct> {
  status: "partial" | "final";
  progress: {
    answered: number;
    estimatedTotal: number;
  };
  criteria: C;
  candidates: Candidate<P>[];
  /** hard-match を通った全件数（candidates は上位 MAX_CANDIDATES 件のみ） */
  matchedCount: number;
  noMatch: boolean;
  noMatchReasons: string[];
  warnings: string[];
  maxScore: number;
  scoreLabels: Record<string, string>;
}

/** 同点時の安定ソート用比較（product_idの昇順） */
function compareStable<P extends CatalogProduct>(a: P, b: P): number {
  return a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;
}

/**
 * 汎用推薦エンジン。
 * deriveCriteria → hardMatch（不適合除外） → score（順位付け） → explain（理由）の順で処理する。
 */
export function recommend<C, P extends CatalogProduct>(
  module: CategoryModule<C, P>,
  answers: AnswerRecord,
  products: P[],
  offersByProduct: ReadonlyMap<string, ProductOffer[]>
): RecommendationResult<C, P> {
  const criteria = module.deriveCriteria(answers);
  const activeKeys = activeQuestionKeys(module.questions, answers);
  const answeredCount = activeKeys.filter((k) => answers[k] !== undefined).length;

  // 暫定候補の開始条件は partialEligibility 設定のみで決まる（単一の真実）
  if (answeredCount < module.partialEligibility.minAnswers) {
    return {
      status: "partial",
      progress: { answered: answeredCount, estimatedTotal: activeKeys.length },
      criteria,
      candidates: [],
      matchedCount: 0,
      noMatch: false,
      noMatchReasons: [],
      warnings: ["もう少し質問に答えると候補を表示できます。"],
      maxScore: module.attainableMaxScore ? module.attainableMaxScore(criteria) : module.maxScore,
      scoreLabels: module.scoreLabels,
    };
  }

  const hardResults = new Map<string, HardMatchResult>();
  const hardPassed: P[] = [];
  const noMatchReasons = new Set<string>();

  for (const product of products) {
    const result = module.hardMatch(product, criteria);
    hardResults.set(product.productId, result);
    if (result.pass) {
      hardPassed.push(product);
    } else {
      for (const reason of result.reasons) {
        noMatchReasons.add(reason);
      }
    }
  }

  const scored = hardPassed.map((product) => {
    const score = module.score(product, criteria, offersByProduct.get(product.productId));
    const reasons = module.explain(product, criteria, offersByProduct.get(product.productId));
    const weakPoints = module.weakPoints
      ? module.weakPoints(product, criteria, offersByProduct.get(product.productId))
      : [];
    return { product, score, reasons, weakPoints };
  });

  scored.sort((a, b) => b.score.score - a.score.score || compareStable(a.product, b.product));

  const candidates: Candidate<P>[] = scored
    .slice(0, MAX_CANDIDATES)
    .map(({ product, score, reasons, weakPoints }) => ({
      product,
      offers: offersByProduct.get(product.productId) ?? [],
      reasons,
      weakPoints,
      scoreBreakdown: score.breakdown,
      totalScore: score.score,
    }));

  const warnings: string[] = [];
  const importantUnanswered = module.unansweredImportantKeys(answers);
  if (importantUnanswered.length > 0) {
    warnings.push("未回答の条件があります。現在の回答に基づく候補です。");
  }
  if (module.buildWarnings) {
    warnings.push(...module.buildWarnings(answers, criteria, products));
  }

  const allAnswered = activeKeys.every((k) => answers[k] !== undefined);

  return {
    status: allAnswered ? "final" : "partial",
    progress: {
      answered: answeredCount,
      estimatedTotal: activeKeys.length,
    },
    criteria,
    candidates,
    matchedCount: hardPassed.length,
    noMatch: hardPassed.length === 0,
    noMatchReasons: [...noMatchReasons],
    warnings,
    maxScore: module.attainableMaxScore ? module.attainableMaxScore(criteria) : module.maxScore,
    scoreLabels: module.scoreLabels,
  };
}
