import { z } from "zod";
import { recommend, MAX_CANDIDATES } from "../shared/domain/engine";
import { getModule, listModules } from "../shared/domain/registry";
import type { CatalogProduct, ProductOffer, AnswerRecord } from "../shared/domain/types";
import { getActiveProductById, listActiveProducts, listOffersForProducts } from "./repo/catalog";
import { json } from "./http";
import type { Env } from "./env";

export const evaluationRequestSchema = z.object({
  categoryKey: z.string().min(1),
  answers: z.record(z.string(), z.string()),
});

function validateAnswers(moduleKey: string, answers: AnswerRecord): string[] {
  const module = getModule(moduleKey);
  const errors: string[] = [];
  for (const [key, value] of Object.entries(answers)) {
    const question = module.questions.find((q) => q.key === key);
    if (!question) {
      errors.push(`unknown question key: ${key}`);
      continue;
    }
    if (!question.options.some((o) => o.value === value)) {
      errors.push(`invalid value for ${key}: ${value}`);
    }
  }
  return errors;
}

/** 表示用に _sources を specs から分離して sources フィールドへ移す */
function splitSources(product: CatalogProduct) {
  const { _sources, ...specs } = product.specs as Record<string, unknown> & {
    _sources?: Array<{ url: string; checkedAt: string }>;
  };
  return {
    product: {
      productId: product.productId,
      manufacturer: product.manufacturer,
      model: product.model,
      displayName: product.displayName,
      specs,
      referencePriceYen: product.referencePriceYen,
      availability: product.availability,
    },
    sources: _sources ?? [],
  };
}

export async function handleConfig(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requested = url.searchParams.get("category") ?? undefined;
  const keys = listModules();
  const key = requested && keys.includes(requested) ? requested : keys[0];
  if (!key) {
    return json({ error: "no_categories_registered" }, { status: 500 });
  }
  const module = getModule(key);
  return json({
    categoryKey: key,
    questions: module.questions,
    maxCandidates: MAX_CANDIDATES,
    scoreLabels: module.scoreLabels,
    maxScore: module.maxScore,
  });
}

export async function handleEvaluate(env: Env, body: unknown): Promise<Response> {
  const parsed = evaluationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid_request", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }
  const { categoryKey, answers } = parsed.data;

  let module;
  try {
    module = getModule(categoryKey);
  } catch {
    return json({ error: "unsupported_category", categoryKey }, { status: 400 });
  }

  const answerErrors = validateAnswers(categoryKey, answers);
  if (answerErrors.length > 0) {
    return json({ error: "invalid_answers", issues: answerErrors }, { status: 400 });
  }

  const criteria = module.deriveCriteria(answers);
  if (!module.canShowPartialResult(answers, criteria)) {
    return json(
      { error: "insufficient_answers", message: "もう少し質問に答えてください" },
      { status: 400 }
    );
  }

  const products = await listActiveProducts(env.DB, categoryKey);

  const offersByProduct = new Map<string, ProductOffer[]>();
  for (const offer of await listOffersForProducts(
    env.DB,
    categoryKey,
    products.map((p) => p.productId)
  )) {
    const list = offersByProduct.get(offer.productId) ?? [];
    list.push(offer);
    offersByProduct.set(offer.productId, list);
  }

  const result = recommend(module, answers, products, offersByProduct);

  return json({
    status: result.status,
    progress: result.progress,
    criteria: result.criteria,
    noMatch: result.noMatch,
    noMatchReasons: result.noMatchReasons,
    warnings: result.warnings,
    maxScore: result.maxScore,
    scoreLabels: result.scoreLabels,
    candidates: result.candidates.map((c) => ({
      ...splitSources(c.product),
      offers: c.offers,
      reasons: c.reasons,
      scoreBreakdown: c.scoreBreakdown,
      totalScore: c.totalScore,
      specItems: module.formatSpecs(c.product),
    })),
  });
}

export async function handleProductDetail(env: Env, productId: string): Promise<Response> {
  if (!/^[a-z0-9-]+$/.test(productId)) {
    return json({ error: "invalid_product_id" }, { status: 400 });
  }
  const keys = listModules();
  for (const categoryKey of keys) {
    const product = await getActiveProductById(env.DB, categoryKey, productId);
    if (product) {
      const offers = await listOffersForProducts(env.DB, categoryKey, [productId]);
      const module = getModule(categoryKey);
      return json({
        ...splitSources(product),
        offers,
        specItems: module.formatSpecs(product),
        scoreLabels: module.scoreLabels,
        maxScore: module.maxScore,
      });
    }
  }
  return json({ error: "product_not_found", productId }, { status: 404 });
}
