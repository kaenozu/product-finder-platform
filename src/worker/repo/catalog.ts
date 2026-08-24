import type { CatalogProduct, ProductOffer } from "../../shared/domain/types";

export interface ProductRow {
  product_id: string;
  category_key: string;
  manufacturer: string;
  model: string;
  display_name: string;
  specs_json: string;
  availability: string;
  source_key: string;
  source_updated_at: string;
  ingested_at: string;
  reference_price_yen: number | null;
}

export interface OfferRow {
  product_id: string;
  provider_key: string;
  provider_item_id: string;
  outbound_url: string;
  price_minor: number | null;
  currency: string | null;
  availability: string | null;
  updated_at: string;
}

export type CatalogVersionStatus = "staging" | "valid" | "published" | "rejected";

/** 行数単位で batch を切る上限（D1の1バッチあたり推奨上限の安全値） */
const BATCH_SIZE = 100;

function iso(now: Date): string {
  return now.toISOString();
}

export function rowToProduct(row: ProductRow): CatalogProduct {
  return {
    productId: row.product_id,
    categoryKey: row.category_key,
    manufacturer: row.manufacturer,
    model: row.model,
    displayName: row.display_name,
    specs: JSON.parse(row.specs_json) as Record<string, unknown>,
    referencePriceYen: row.reference_price_yen,
    availability: row.availability as CatalogProduct["availability"],
    sourceKey: row.source_key,
    sourceUpdatedAt: row.source_updated_at,
    ingestedAt: row.ingested_at,
  };
}

export function rowToOffer(row: OfferRow): ProductOffer {
  return {
    productId: row.product_id,
    providerKey: row.provider_key,
    providerItemId: row.provider_item_id,
    outboundUrl: row.outbound_url,
    priceMinor: row.price_minor,
    currency: row.currency ?? "JPY",
    availability: row.availability,
    updatedAt: row.updated_at,
  };
}

export async function ensureCatalogState(
  db: D1Database,
  categoryKey: string,
  now: Date = new Date()
): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO catalog_state (category_key, active_version_id, updated_at) VALUES (?, NULL, ?)"
    )
    .bind(categoryKey, iso(now))
    .run();
}

export async function getActiveVersionId(
  db: D1Database,
  categoryKey: string
): Promise<string | null> {
  const row = await db
    .prepare("SELECT active_version_id FROM catalog_state WHERE category_key = ?")
    .bind(categoryKey)
    .first<{ active_version_id: string | null }>();
  return row?.active_version_id ?? null;
}

export interface CatalogReadiness {
  categoryKey: string;
  activeVersionId: string | null;
  activeVersionStatus: CatalogVersionStatus | null;
  productCount: number;
  offerCount: number;
}

/** 公開診断に使えるactive catalogの状態を集約して返す。 */
export async function getCatalogReadiness(
  db: D1Database,
  categoryKey: string
): Promise<CatalogReadiness> {
  const row = await db
    .prepare(
      `SELECT s.active_version_id,
              v.status AS active_version_status,
              COUNT(DISTINCT p.product_id) AS product_count,
              COUNT(DISTINCT o.product_id) AS offer_count
       FROM catalog_state s
       LEFT JOIN catalog_versions v ON v.version_id = s.active_version_id
       LEFT JOIN products p ON p.version_id = s.active_version_id AND p.category_key = ?
       LEFT JOIN product_offers o
         ON o.version_id = s.active_version_id AND o.product_id = p.product_id
       WHERE s.category_key = ?
       GROUP BY s.active_version_id, v.status`
    )
    .bind(categoryKey, categoryKey)
    .first<{
      active_version_id: string | null;
      active_version_status: CatalogVersionStatus | null;
      product_count: number;
      offer_count: number;
    }>();

  return {
    categoryKey,
    activeVersionId: row?.active_version_id ?? null,
    activeVersionStatus: row?.active_version_status ?? null,
    productCount: row?.product_count ?? 0,
    offerCount: row?.offer_count ?? 0,
  };
}

/** staging バージョンを作成し、その version_id を返す */
export async function createStagingVersion(
  db: D1Database,
  categoryKey: string,
  sourceKey: string,
  itemCount: number,
  now: Date = new Date()
): Promise<string> {
  const versionId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO catalog_versions (version_id, category_key, source_key, status, item_count, created_at) VALUES (?, ?, ?, 'staging', ?, ?)"
    )
    .bind(versionId, categoryKey, sourceKey, itemCount, iso(now))
    .run();
  return versionId;
}

/** products を一括insert（重複キーは更新） */
export async function insertProducts(
  db: D1Database,
  versionId: string,
  products: CatalogProduct[]
): Promise<void> {
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const chunk = products.slice(i, i + BATCH_SIZE);
    await db.batch(
      chunk.map((p) =>
        db
          .prepare(
            `INSERT INTO products
              (version_id, product_id, category_key, manufacturer, model, display_name, specs_json, availability, source_key, source_updated_at, ingested_at, reference_price_yen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(version_id, product_id) DO UPDATE SET
               manufacturer=excluded.manufacturer, model=excluded.model, display_name=excluded.display_name,
               specs_json=excluded.specs_json, availability=excluded.availability,
               source_key=excluded.source_key, source_updated_at=excluded.source_updated_at, ingested_at=excluded.ingested_at,
               reference_price_yen=excluded.reference_price_yen`
          )
          .bind(
            versionId,
            p.productId,
            p.categoryKey,
            p.manufacturer,
            p.model,
            p.displayName,
            JSON.stringify(p.specs),
            p.availability,
            p.sourceKey,
            p.sourceUpdatedAt,
            p.ingestedAt,
            p.referencePriceYen
          )
      )
    );
  }
}

export async function insertOffers(
  db: D1Database,
  versionId: string,
  offers: ProductOffer[]
): Promise<void> {
  for (let i = 0; i < offers.length; i += BATCH_SIZE) {
    const chunk = offers.slice(i, i + BATCH_SIZE);
    await db.batch(
      chunk.map((o) =>
        db
          .prepare(
            `INSERT INTO product_offers
              (version_id, product_id, provider_key, provider_item_id, outbound_url, price_minor, currency, availability, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(version_id, product_id, provider_key) DO UPDATE SET
               provider_item_id=excluded.provider_item_id, outbound_url=excluded.outbound_url,
               price_minor=excluded.price_minor, currency=excluded.currency,
               availability=excluded.availability, updated_at=excluded.updated_at`
          )
          .bind(
            versionId,
            o.productId,
            o.providerKey,
            o.providerItemId,
            o.outboundUrl,
            o.priceMinor,
            o.currency,
            o.availability,
            o.updatedAt
          )
      )
    );
  }
}

export async function setVersionStatus(
  db: D1Database,
  versionId: string,
  status: CatalogVersionStatus,
  now: Date = new Date()
): Promise<void> {
  const publishedAt = status === "published" ? iso(now) : null;
  await db
    .prepare("UPDATE catalog_versions SET status = ?, published_at = ? WHERE version_id = ?")
    .bind(status, publishedAt, versionId)
    .run();
}

/** 公開バージョンを切り替え（ロールバック含む）。catalog_state.active_version_id を更新 */
export async function setActiveVersion(
  db: D1Database,
  categoryKey: string,
  versionId: string | null,
  now: Date = new Date()
): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO catalog_state (category_key, active_version_id, updated_at) VALUES (?, ?, ?)"
    )
    .bind(categoryKey, versionId, iso(now))
    .run();
}

/**
 * バージョンを公開（published化 + catalog_state.active_version_id 更新）を1バッチで原子的に実行。
 */
export async function publishVersion(
  db: D1Database,
  categoryKey: string,
  versionId: string,
  now: Date = new Date()
): Promise<boolean> {
  const [activateResult] = await db.batch([
    db
      .prepare(
        `UPDATE catalog_state
         SET active_version_id = ?, updated_at = ?
         WHERE category_key = ?
           AND EXISTS (
             SELECT 1 FROM catalog_versions candidate
             WHERE candidate.version_id = ? AND candidate.category_key = ? AND candidate.status = 'valid'
           )
           AND (
             active_version_id IS NULL OR
             (SELECT created_at FROM catalog_versions WHERE version_id = active_version_id) <
             (SELECT created_at FROM catalog_versions WHERE version_id = ?)
           )`
      )
      .bind(versionId, iso(now), categoryKey, versionId, categoryKey, versionId),
    db
      .prepare(
        `UPDATE catalog_versions
         SET status = 'published', published_at = ?
         WHERE version_id = ?
           AND EXISTS (
             SELECT 1 FROM catalog_state
             WHERE category_key = ? AND active_version_id = ?
           )`
      )
      .bind(iso(now), versionId, categoryKey, versionId),
    db
      .prepare(
        `UPDATE catalog_versions
         SET status = 'rejected', published_at = NULL
         WHERE version_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM catalog_state
             WHERE category_key = ? AND active_version_id = ?
           )`
      )
      .bind(versionId, categoryKey, versionId),
  ]);

  // The batch result belongs to this publication attempt. Re-reading catalog_state here
  // would introduce a TOCTOU race if a newer version publishes immediately after this batch.
  return (activateResult?.meta.changes ?? 0) > 0;
}

/** 現在の公開バージョンの商品一覧を取得 */
export async function listActiveProducts(
  db: D1Database,
  categoryKey: string
): Promise<CatalogProduct[]> {
  const rows = await db
    .prepare(
      `SELECT p.product_id, p.category_key, p.manufacturer, p.model, p.display_name,
              p.specs_json, p.availability, p.source_key, p.source_updated_at, p.ingested_at,
              p.reference_price_yen
       FROM products p
       JOIN catalog_state s ON s.active_version_id = p.version_id
       WHERE p.category_key = ?
       ORDER BY p.product_id`
    )
    .bind(categoryKey)
    .all<ProductRow>();
  return (rows.results ?? []).map(rowToProduct);
}

export async function getActiveProductById(
  db: D1Database,
  categoryKey: string,
  productId: string
): Promise<CatalogProduct | null> {
  const row = await db
    .prepare(
      `SELECT p.product_id, p.category_key, p.manufacturer, p.model, p.display_name,
              p.specs_json, p.availability, p.source_key, p.source_updated_at, p.ingested_at,
              p.reference_price_yen
       FROM products p
       JOIN catalog_state s ON s.active_version_id = p.version_id AND s.category_key = p.category_key
       WHERE p.category_key = ? AND p.product_id = ?`
    )
    .bind(categoryKey, productId)
    .first<ProductRow>();
  return row ? rowToProduct(row) : null;
}

/**
 * 複数カテゴリのactive版からproductIdで商品を1件検索する（単一クエリ）。
 * 複数カテゴリで同一productIdが衝突した場合は category_key 順で先頭を採用する
 * （決定性は保証。productIdはカテゴリ横断で一意に運用すること）。
 */
export async function getActiveProductAcrossCategories(
  db: D1Database,
  categoryKeys: string[],
  productId: string
): Promise<CatalogProduct | null> {
  if (categoryKeys.length === 0) return null;
  const placeholders = categoryKeys.map(() => "?").join(",");
  const row = await db
    .prepare(
      `SELECT p.product_id, p.category_key, p.manufacturer, p.model, p.display_name,
              p.specs_json, p.availability, p.source_key, p.source_updated_at, p.ingested_at,
              p.reference_price_yen
       FROM products p
       JOIN catalog_state s ON s.active_version_id = p.version_id AND s.category_key = p.category_key
       WHERE p.product_id = ? AND p.category_key IN (${placeholders})
       ORDER BY p.category_key
       LIMIT 1`
    )
    .bind(productId, ...categoryKeys)
    .first<ProductRow>();
  return row ? rowToProduct(row) : null;
}

/** 指定カテゴリのいずれかに published な active catalog が存在するか（fail-closed判定用） */
export async function hasPublishedCatalog(
  db: D1Database,
  categoryKeys: string[]
): Promise<boolean> {
  if (categoryKeys.length === 0) return false;
  const placeholders = categoryKeys.map(() => "?").join(",");
  const row = await db
    .prepare(
      `SELECT 1 AS ok
       FROM catalog_state s
       JOIN catalog_versions v ON v.version_id = s.active_version_id AND v.status = 'published'
       WHERE s.category_key IN (${placeholders})
       LIMIT 1`
    )
    .bind(...categoryKeys)
    .first<{ ok: number }>();
  return row !== null;
}

/** 特定バージョン・商品群のオファー一覧（カテゴリのactive版のみ） */
export async function listOffersForProducts(
  db: D1Database,
  categoryKey: string,
  productIds: string[]
): Promise<ProductOffer[]> {
  if (productIds.length === 0) return [];
  const offers: ProductOffer[] = [];
  const uniqueProductIds = [...new Set(productIds)];
  // D1は1クエリ100 bound parametersまで。categoryKey分を除き99件ずつ取得する。
  for (let i = 0; i < uniqueProductIds.length; i += 99) {
    const chunk = uniqueProductIds.slice(i, i + 99);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT o.product_id, o.provider_key, o.provider_item_id, o.outbound_url,
                o.price_minor, o.currency, o.availability, o.updated_at
         FROM product_offers o
         JOIN catalog_state s ON s.active_version_id = o.version_id
         JOIN catalog_versions v ON v.version_id = o.version_id AND v.category_key = ?
         WHERE o.product_id IN (${placeholders})`
      )
      .bind(categoryKey, ...chunk)
      .all<OfferRow>();
    offers.push(...(rows.results ?? []).map(rowToOffer));
  }
  return offers;
}

export async function createIngestRun(
  db: D1Database,
  sourceKey: string,
  categoryKey: string,
  startedAt: Date
): Promise<string> {
  const runId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO ingest_runs (run_id, source_key, category_key, started_at, status) VALUES (?, ?, ?, ?, 'running')"
    )
    .bind(runId, sourceKey, categoryKey, iso(startedAt))
    .run();
  return runId;
}

/** 直近の成功runのcontent_hashを取得（no-op判定用） */
export async function getLastContentHash(
  db: D1Database,
  categoryKey: string,
  sourceKey: string
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT content_hash FROM ingest_runs
       WHERE category_key = ? AND source_key = ? AND status = 'succeeded' AND content_hash IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`
    )
    .bind(categoryKey, sourceKey)
    .first<{ content_hash: string | null }>();
  return row?.content_hash ?? null;
}

export interface IngestHealth {
  categoryKey: string;
  lastIngestStatus: string | null;
  lastIngestFinishedAt: string | null;
  lastSourceUpdatedAt: string | null;
  consecutiveFailures: number;
}

/**
 * カテゴリのingest運用健全性を返す。
 * active catalogのsource_updated_at（鮮度）と直近ingest runの状態を監査する。
 */
export async function getIngestHealth(db: D1Database, categoryKey: string): Promise<IngestHealth> {
  const latest = await db
    .prepare(
      `SELECT status, finished_at
       FROM ingest_runs
       WHERE category_key = ?
       ORDER BY started_at DESC LIMIT 1`
    )
    .bind(categoryKey)
    .first<{ status: string; finished_at: string | null }>();

  const freshRow = await db
    .prepare(
      `SELECT MAX(p.source_updated_at) AS last_source_updated_at
       FROM products p
       JOIN catalog_state s ON s.active_version_id = p.version_id
       WHERE s.category_key = ?`
    )
    .bind(categoryKey)
    .first<{ last_source_updated_at: string | null }>();

  let consecutiveFailures = 0;
  if (latest && latest.status !== "succeeded") {
    const rows = await db
      .prepare(
        `SELECT status FROM ingest_runs
         WHERE category_key = ?
         ORDER BY started_at DESC LIMIT 10`
      )
      .bind(categoryKey)
      .all<{ status: string }>();
    for (const row of rows.results ?? []) {
      if (row.status === "succeeded") break;
      consecutiveFailures++;
    }
  }

  return {
    categoryKey,
    lastIngestStatus: latest?.status ?? null,
    lastIngestFinishedAt: latest?.finished_at ?? null,
    lastSourceUpdatedAt: freshRow?.last_source_updated_at ?? null,
    consecutiveFailures,
  };
}

export async function finishIngestRun(
  db: D1Database,
  runId: string,
  status: "succeeded" | "failed" | "rejected",
  finishedAt: Date,
  args: {
    fetchedCount: number;
    normalizedCount: number;
    rejectedCount: number;
    errorSummary?: string;
    candidateVersion?: string;
    contentHash?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE ingest_runs
       SET status = ?, finished_at = ?, fetched_count = ?, normalized_count = ?,
           rejected_count = ?, error_summary = ?, candidate_version = ?, content_hash = ?
       WHERE run_id = ?`
    )
    .bind(
      status,
      iso(finishedAt),
      args.fetchedCount,
      args.normalizedCount,
      args.rejectedCount,
      args.errorSummary ?? null,
      args.candidateVersion ?? null,
      args.contentHash ?? null,
      runId
    )
    .run();
}

/** 過去の非公開バージョン（staging/rejected）を残数 keepCount まで削除して領域を整理する */
export async function pruneOldVersions(
  db: D1Database,
  categoryKey: string,
  keepCount: number
): Promise<void> {
  const rows = await db
    .prepare(
      `SELECT version_id FROM catalog_versions
       WHERE category_key = ? AND status IN ('staging', 'rejected')
       ORDER BY created_at DESC
       LIMIT -1 OFFSET ?`
    )
    .bind(categoryKey, keepCount)
    .all<{ version_id: string }>();
  const victims = (rows.results ?? []).map((r) => r.version_id);
  if (victims.length === 0) return;
  // D1 permits at most 100 bound parameters per query. Delete each group atomically,
  // and keep processing until every selected victim has been removed.
  for (let i = 0; i < victims.length; i += 100) {
    const chunk = victims.slice(i, i + 100);
    const placeholders = chunk.map(() => "?").join(",");
    await db.batch([
      db.prepare(`DELETE FROM products WHERE version_id IN (${placeholders})`).bind(...chunk),
      db.prepare(`DELETE FROM product_offers WHERE version_id IN (${placeholders})`).bind(...chunk),
      db
        .prepare(`DELETE FROM catalog_versions WHERE version_id IN (${placeholders})`)
        .bind(...chunk),
    ]);
  }
}

/**
 * running状態のingest runをreconcileする。
 *
 * catalog_state.active_version_id を source of truth とし、
 * running超過のingest runについて:
 * - candidate_version が active_version_id と一致 → succeeded に修正
 * - candidate_version が存在しない/未publish → failed に修正
 *
 * staleMinutes: running超過とみなす分数（デフォルト30分）
 * 返り値: 修正したrun_idの一覧
 */
export async function reconcileStaleIngestRuns(
  db: D1Database,
  staleMinutes = 30
): Promise<string[]> {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  // active versionをJOINで一括取得し、UPDATEは1バッチにまとめる（N+1回避）
  const stale = await db
    .prepare(
      `SELECT ir.run_id, ir.candidate_version, s.active_version_id
       FROM ingest_runs ir
       LEFT JOIN catalog_state s ON s.category_key = ir.category_key
       WHERE ir.status = 'running' AND ir.started_at < ?`
    )
    .bind(iso(cutoff))
    .all<{ run_id: string; candidate_version: string | null; active_version_id: string | null }>();

  const finishedAt = iso(new Date());
  const statements: D1PreparedStatement[] = [];
  const reconciled: string[] = [];

  for (const run of stale.results ?? []) {
    if (!run.candidate_version) {
      statements.push(
        db
          .prepare(
            `UPDATE ingest_runs SET status = 'failed', finished_at = ?,
             error_summary = 'reconciled: no candidate version (stale running)'
             WHERE run_id = ?`
          )
          .bind(finishedAt, run.run_id)
      );
      reconciled.push(run.run_id);
      continue;
    }

    const isActive = run.active_version_id === run.candidate_version;
    const newStatus = isActive ? "succeeded" : "failed";
    const summary = isActive
      ? "reconciled: candidate is active version (audit was lost)"
      : "reconciled: candidate is not active version";

    statements.push(
      db
        .prepare(
          `UPDATE ingest_runs SET status = ?, finished_at = ?, error_summary = ? WHERE run_id = ?`
        )
        .bind(newStatus, finishedAt, summary, run.run_id)
    );
    reconciled.push(run.run_id);
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return reconciled;
}
