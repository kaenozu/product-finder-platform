import { z } from "zod";
import { recommend, MAX_CANDIDATES } from "../shared/domain/engine";
import { activeQuestionKeys } from "../shared/domain/flow";
import { getModule, listModules } from "../shared/domain/registry";
import type { CatalogProduct, ProductOffer, AnswerRecord } from "../shared/domain/types";
import {
  getActiveProductAcrossCategories,
  getCatalogReadiness,
  getIngestHealth,
  hasPublishedCatalog,
  listActiveProducts,
  listOffersForProducts,
} from "./repo/catalog";
import { json } from "./http";
import type { Env } from "./env";

/**
 * 公開有効なカテゴリキーの一覧を取得する。
 * ENABLED_CATEGORIES が未設定なら全カテゴリを有効とする（後方互換）。
 * カンマ区切りの文字列からパースする。
 */
export function getEnabledCategories(env: Env): Set<string> {
  const all = new Set(listModules());
  if (env.ENABLED_CATEGORIES === undefined || env.ENABLED_CATEGORIES === null) return all;
  const enabled = new Set(
    env.ENABLED_CATEGORIES.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  // ENABLED_CATEGORIES に含まれるが registry に未登録のキーは無視
  return new Set([...enabled].filter((k) => all.has(k)));
}

export const evaluationRequestSchema = z.object({
  categoryKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  answers: z
    .record(
      z
        .string()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z0-9_-]+$/),
      z.string().min(1).max(128)
    )
    .refine((answers) => Object.keys(answers).length <= 100, "回答数が多すぎます"),
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
  const activeKeys = new Set(activeQuestionKeys(module.questions, answers));
  for (const key of Object.keys(answers)) {
    if (!activeKeys.has(key) && module.questions.some((question) => question.key === key)) {
      errors.push(`inactive question key: ${key}`);
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
      sourceUpdatedAt: product.sourceUpdatedAt,
      ingestedAt: product.ingestedAt,
      imageUrl: specs.imageUrl ?? null,
    },
    sources: _sources ?? [],
  };
}

/**
 * DB読み出しの汎用行をmodule.parseProductで検証込みカテゴリ型へ絞め込む。
 * 全行が破損していた場合はnull（呼び出し側がcatalog_unavailableとして扱う）。
 */
function toTypedProducts<P extends CatalogProduct>(
  module: { parseProduct(raw: CatalogProduct): P | null },
  rows: CatalogProduct[]
): P[] | null {
  const typed: P[] = [];
  let invalid = 0;
  for (const row of rows) {
    const parsed = module.parseProduct(row);
    if (parsed === null) {
      invalid += 1;
      console.warn(`[api] product failed category type validation: ${row.productId}`);
    } else {
      typed.push(parsed);
    }
  }
  if (typed.length === 0 && rows.length > 0) return null;
  if (invalid > 0) {
    console.warn(`[api] ${invalid}/${rows.length} products skipped by type validation`);
  }
  return typed;
}

/** カテゴリ一覧（pitariko ポータル表示用） */
export async function handleCategories(env: Env): Promise<Response> {
  const enabledKeys = getEnabledCategories(env);
  const categories = listModules()
    .filter((key) => enabledKeys.has(key))
    .map((key) => {
      const module = getModule(key);
      return {
        categoryKey: key,
        questionCount: module.questions.length,
        copy: {
          appTitle: module.copy.appTitle,
          heroTitle: module.copy.heroTitle,
          heroLead: module.copy.heroLead,
          resultTitle: module.copy.resultTitle,
          resultPreview: module.copy.resultPreview,
        },
      };
    });
  return json({ categories });
}

/**
 * カテゴリの readiness 状態。
 * - enabled: ENABLED_CATEGORIES で公開有効かどうか
 * - deployed: active catalog が存在するか（未デプロイ = rollout 中）
 * - published: active catalog が published かつ productCount > 0
 */
interface DataHealth {
  lastIngestStatus: string | null;
  lastIngestFinishedAt: string | null;
  lastSourceUpdatedAt: string | null;
  consecutiveFailures: number;
  sourceFresh: boolean;
  latestIngestHealthy: boolean;
}

interface CategoryReadiness {
  categoryKey: string;
  enabled: boolean;
  deployed: boolean;
  published: boolean;
  activeVersionStatus: string | null;
  productCount: number;
  dataHealthy: boolean;
  dataHealth: DataHealth;
}

/**
 * サービスレベル readiness。
 *
 * enabled + deployed カテゴリは published でなければならない（fail-closed）。
 * enabled カテゴリはトラフィック対象なので、active catalog が無い場合も
 * readiness を block する（空のfilter + every([])によるfail-openを防ぐ）。
 */
export async function handleReady(env: Env): Promise<Response> {
  const enabledKeys = getEnabledCategories(env);
  const allCategories = await Promise.all(
    listModules().map(async (categoryKey) => {
      const [readiness, health] = await Promise.all([
        getCatalogReadiness(env.DB, categoryKey),
        getIngestHealth(env.DB, categoryKey),
      ]);
      const published = readiness.activeVersionStatus === "published" && readiness.productCount > 0;
      const deployed = readiness.activeVersionId !== null;
      const dataHealthy = health.sourceFresh && health.latestIngestHealthy;
      return {
        categoryKey,
        enabled: enabledKeys.has(categoryKey),
        deployed,
        published,
        activeVersionStatus: readiness.activeVersionStatus,
        productCount: readiness.productCount,
        dataHealth: {
          lastIngestStatus: health.lastIngestStatus,
          lastIngestFinishedAt: health.lastIngestFinishedAt,
          lastSourceUpdatedAt: health.lastSourceUpdatedAt,
          consecutiveFailures: health.consecutiveFailures,
          sourceFresh: health.sourceFresh,
          latestIngestHealthy: health.latestIngestHealthy,
        },
        // A deployed catalog is traffic-ready only when its source data is
        // fresh and the latest ingest completed successfully.  Undeployed
        // categories remain rollout-only and do not block the service.
        dataHealthy,
      } satisfies CategoryReadiness;
    })
  );

  const enabledCategories = allCategories.filter((c) => c.enabled);
  const serviceReady =
    enabledCategories.length > 0 &&
    enabledCategories.every((c) => c.deployed && c.published && c.dataHealthy);

  return json(
    {
      ok: serviceReady,
      service: "product-finder-platform",
      categories: allCategories,
    },
    { status: serviceReady ? 200 : 503 }
  );
}

export async function handleConfig(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // category指定は必須。未指定での暗黙fallback（registry登録順依存）を廃止する。
  const requested = url.searchParams.get("category");
  if (!requested) {
    return json({ error: "missing_category" }, { status: 400 });
  }
  const keys = listModules();
  if (!keys.includes(requested)) {
    return json({ error: "unsupported_category", categoryKey: requested }, { status: 404 });
  }
  const key = requested;
  if (!getEnabledCategories(env).has(key)) {
    return json({ error: "category_not_enabled", categoryKey: key }, { status: 404 });
  }
  const module = getModule(key);
  return json({
    categoryKey: key,
    questions: module.questions,
    maxCandidates: MAX_CANDIDATES,
    scoreLabels: module.scoreLabels,
    maxScore: module.maxScore,
    partialEligibility: module.partialEligibility,
    copy: module.copy,
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

  // 公開有効でないカテゴリは診断を拒否
  const enabledKeys = getEnabledCategories(env);
  if (!enabledKeys.has(categoryKey)) {
    return json(
      {
        error: "category_not_enabled",
        categoryKey,
        message: "このカテゴリはまだ公開されていません",
      },
      { status: 404 }
    );
  }

  const answerErrors = validateAnswers(categoryKey, answers);
  if (answerErrors.length > 0) {
    return json({ error: "invalid_answers", issues: answerErrors }, { status: 400 });
  }

  // 暫定候補の開始条件（partialEligibility.minAnswers）を満たすか。判定はエンジンと同一規則。
  const activeKeys = activeQuestionKeys(module.questions, answers);
  const answeredCount = activeKeys.filter((k) => answers[k] !== undefined).length;
  if (answeredCount < module.partialEligibility.minAnswers) {
    return json(
      { error: "insufficient_answers", message: "もう少し質問に答えてください" },
      { status: 400 }
    );
  }

  const catalog = await getCatalogReadiness(env.DB, categoryKey);
  if (catalog.activeVersionStatus !== "published" || catalog.productCount === 0) {
    return json(
      {
        error: "catalog_unavailable",
        categoryKey,
        message: "公開カタログが利用できないため診断を実行できません",
      },
      { status: 503 }
    );
  }

  const rawProducts = await listActiveProducts(env.DB, categoryKey);
  const products = toTypedProducts(module, rawProducts);
  if (products === null) {
    return json(
      {
        error: "catalog_unavailable",
        categoryKey,
        message: "公開カタログが利用できないため診断を実行できません",
      },
      { status: 503 }
    );
  }

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
    matchedCount: result.matchedCount,
    warnings: result.warnings,
    maxScore: result.maxScore,
    scoreLabels: result.scoreLabels,
    candidates: result.candidates.map((c) => ({
      ...splitSources(c.product),
      offers: c.offers,
      reasons: c.reasons,
      weakPoints: c.weakPoints,
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
  const enabledKeys = getEnabledCategories(env);
  const keys = listModules().filter((key) => enabledKeys.has(key));

  // カタログ欠損（一時障害）と商品不存在を区別する（Issue #13）。
  // published な active catalog が1つも無い場合は404ではなく503で応答する。
  const anyPublished = await hasPublishedCatalog(env.DB, keys);
  if (!anyPublished) {
    return json(
      { error: "catalog_unavailable", message: "公開カタログが利用できません" },
      { status: 503 }
    );
  }

  const product = await getActiveProductAcrossCategories(env.DB, keys, productId);
  if (product) {
    const offers = await listOffersForProducts(env.DB, product.categoryKey, [productId]);
    const module = getModule(product.categoryKey);
    const typed = module.parseProduct(product);
    if (!typed) {
      console.warn(`[api] product failed category type validation: ${product.productId}`);
      return json({ error: "product_not_found", productId }, { status: 404 });
    }
    return json({
      ...splitSources(typed),
      offers,
      specItems: module.formatSpecs(typed),
      scoreLabels: module.scoreLabels,
      maxScore: module.maxScore,
    });
  }
  return json({ error: "product_not_found", productId }, { status: 404 });
}
