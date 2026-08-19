import { z } from "zod";
import { recommend, MAX_CANDIDATES } from "../shared/domain/engine";
import { getModule } from "../shared/domain/registry";
import type { CatalogProduct, ProductOffer, AnswerRecord } from "../shared/domain/types";
import { getActiveProductById, listActiveProducts, listOffersForProducts } from "./repo/catalog";
import { json } from "./http";
import type { Env } from "./env";

const CATEGORY_KEY = "rice-cooker";

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

export async function handleConfig(): Promise<Response> {
  const module = getModule(CATEGORY_KEY);
  return json({
    categoryKey: CATEGORY_KEY,
    questions: module.questions,
    maxCandidates: MAX_CANDIDATES,
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

  if (categoryKey !== CATEGORY_KEY) {
    return json({ error: "unsupported_category", categoryKey }, { status: 400 });
  }

  const answerErrors = validateAnswers(categoryKey, answers);
  if (answerErrors.length > 0) {
    return json({ error: "invalid_answers", issues: answerErrors }, { status: 400 });
  }

  const module = getModule(categoryKey);
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
    candidates: result.candidates.map((c) => ({
      ...splitSources(c.product),
      offers: c.offers,
      reasons: c.reasons,
      scoreBreakdown: c.scoreBreakdown,
      totalScore: c.totalScore,
    })),
  });
}

export async function handleProductDetail(env: Env, productId: string): Promise<Response> {
  if (!/^[a-z0-9-]+$/.test(productId)) {
    return json({ error: "invalid_product_id" }, { status: 400 });
  }
  const product = await getActiveProductById(env.DB, CATEGORY_KEY, productId);
  if (!product) {
    return json({ error: "product_not_found", productId }, { status: 404 });
  }
  const offers = await listOffersForProducts(env.DB, CATEGORY_KEY, [productId]);
  return json({ ...splitSources(product), offers });
}

export async function handleNoMatch(env: Env): Promise<Response> {
  void env;
  return json({ error: "method_not_allowed" }, { status: 405 });
}
