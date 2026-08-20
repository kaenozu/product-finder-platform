import type { CatalogProduct, CategoryModule } from "./types";
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
  canShowPartialResult,
  deriveCriteria,
  explain,
  formatSpecs,
  hardMatch,
  qualityGates,
  score,
  unansweredImportantKeys,
  weakPoints,
} from "./rice-cooker/module";

export const riceCookerModule: CategoryModule<RiceCookerCriteria, RiceCookerProduct> = {
  key: "rice-cooker",
  questions: QUESTIONS,
  deriveCriteria,
  canShowPartialResult,
  partialEligibility: { type: "answered_at_least", minAnswers: 2 },
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

const MODULES = new Map<string, CategoryModule<unknown, never>>([
  [riceCookerModule.key, riceCookerModule],
]);

/** 登録済みモジュールの質問グラフを検証する（起動時のセーフティネット） */
export function validateRegisteredModules(): string[] {
  const issues: string[] = [];
  for (const [key, module] of MODULES) {
    for (const issue of validateQuestionGraph(module.questions)) {
      issues.push(`[${key}] ${issue.message}`);
    }
  }
  return issues;
}

export function getModule<C, P extends CatalogProduct>(key: string): CategoryModule<C, P> {
  const module = MODULES.get(key);
  if (!module) throw new Error(`unknown category: ${key}`);
  return module as CategoryModule<C, P>;
}

export function listModules(): string[] {
  return [...MODULES.keys()];
}

const registrationIssues = validateRegisteredModules();
if (registrationIssues.length > 0) {
  throw new Error(`invalid category modules: ${registrationIssues.join("; ")}`);
}
