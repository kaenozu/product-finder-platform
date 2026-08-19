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
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "UPDATE catalog_versions SET status = 'published', published_at = ? WHERE version_id = ?"
      )
      .bind(iso(now), versionId),
    db
      .prepare(
        "INSERT OR REPLACE INTO catalog_state (category_key, active_version_id, updated_at) VALUES (?, ?, ?)"
      )
      .bind(categoryKey, versionId, iso(now)),
  ]);
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
       JOIN catalog_state s ON s.active_version_id = p.version_id
       WHERE p.category_key = ? AND p.product_id = ?`
    )
    .bind(categoryKey, productId)
    .first<ProductRow>();
  return row ? rowToProduct(row) : null;
}

/** 特定バージョン・商品群のオファー一覧（カテゴリのactive版のみ） */
export async function listOffersForProducts(
  db: D1Database,
  categoryKey: string,
  productIds: string[]
): Promise<ProductOffer[]> {
  if (productIds.length === 0) return [];
  const placeholders = productIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT o.product_id, o.provider_key, o.provider_item_id, o.outbound_url,
              o.price_minor, o.currency, o.availability, o.updated_at
       FROM product_offers o
       JOIN catalog_state s ON s.active_version_id = o.version_id
       JOIN catalog_versions v ON v.version_id = o.version_id AND v.category_key = ?
       WHERE o.product_id IN (${placeholders})`
    )
    .bind(categoryKey, ...productIds)
    .all<OfferRow>();
  return (rows.results ?? []).map(rowToOffer);
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
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE ingest_runs
       SET status = ?, finished_at = ?, fetched_count = ?, normalized_count = ?,
           rejected_count = ?, error_summary = ?, candidate_version = ?
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
      runId
    )
    .run();
}
