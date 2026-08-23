import type { CategoryModule } from "./types";
import type { RiceCookerCriteria, RiceCookerProduct } from "./rice-cooker/types";
import { QUESTIONS } from "./rice-cooker/questions";
import { validateQuestionGraph } from "./flow";
import {
  SCORE_LABELS,
  MAX_SCORE,
  COPY,
  REGRESSION_SAMPLE_ANSWERS,
  attainableMaxScore,
  buildWarnings,
  deriveCriteria,
  explain,
  formatSpecs,
  hardMatch,
  parseProduct,
  qualityGates,
  score,
  unansweredImportantKeys,
  weakPoints,
} from "./rice-cooker/module";

export const riceCookerModule: CategoryModule<RiceCookerCriteria, RiceCookerProduct> = {
  key: "rice-cooker",
  questions: QUESTIONS,
  deriveCriteria,
  partialEligibility: { type: "answered_at_least", minAnswers: 2 },
  parseProduct,
  hardMatch,
  score,
  explain,
  weakPoints,
  unansweredImportantKeys,
  buildWarnings,
  scoreLabels: SCORE_LABELS,
  maxScore: MAX_SCORE,
  attainableMaxScore,
  formatSpecs,
  qualityGates,
  regressionSampleAnswers: REGRESSION_SAMPLE_ANSWERS,
  copy: COPY,
};

/**
 * 登録済みカテゴリモジュールの単一登録点。
 * 新カテゴリはここに1行追加するだけで registry・getModule・listModules に反映される。
 * 将来カテゴリが増えたら AnyCategoryModule のユニオンにも追加する。
 */
const MODULES = {
  "rice-cooker": riceCookerModule,
} satisfies Record<string, AnyCategoryModule>;

/** 登録済みモジュールの具象型のユニオン。新カテゴリ追加時にここへ追加する */
export type AnyCategoryModule = CategoryModule<RiceCookerCriteria, RiceCookerProduct>;

export type RegisteredCategoryKey = keyof typeof MODULES;

/** 登録済みモジュールの質問グラフと登録キーの整合を検証する（起動時のセーフティネット） */
export function validateRegisteredModules(): string[] {
  const issues: string[] = [];
  for (const [key, module] of Object.entries(MODULES)) {
    if (module.key !== key) {
      issues.push(`[${key}] module.key (${module.key}) が登録キーと不一致`);
    }
    for (const issue of validateQuestionGraph(module.questions)) {
      issues.push(`[${key}] ${issue.message}`);
    }
  }
  return issues;
}

/**
 * カテゴリキーでモジュールを解決する。未知キーはthrow。
 * 戻り値は具体的な登録済みモジュール型のユニオンであり、
 * 呼び出し側での無検証ジェネリクスキャストを不要にする。
 */
export function getModule(key: string): AnyCategoryModule {
  const module = MODULES[key as RegisteredCategoryKey];
  if (!module) throw new Error(`unknown category: ${key}`);
  return module;
}

export function listModules(): string[] {
  return Object.keys(MODULES);
}

const registrationIssues = validateRegisteredModules();
if (registrationIssues.length > 0) {
  throw new Error(`invalid category modules: ${registrationIssues.join("; ")}`);
}
