import type { CatalogProduct, CategoryModule } from "./types";
import type { RiceCookerCriteria, RiceCookerProduct } from "./rice-cooker/types";
import { QUESTIONS } from "./rice-cooker/questions";
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
} from "./rice-cooker/module";

export const riceCookerModule: CategoryModule<RiceCookerCriteria, RiceCookerProduct> = {
  key: "rice-cooker",
  questions: QUESTIONS,
  deriveCriteria,
  canShowPartialResult,
  hardMatch,
  score,
  explain,
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

export function getModule<C, P extends CatalogProduct>(key: string): CategoryModule<C, P> {
  const module = MODULES.get(key);
  if (!module) throw new Error(`unknown category: ${key}`);
  return module as CategoryModule<C, P>;
}

export function listModules(): string[] {
  return [...MODULES.keys()];
}
