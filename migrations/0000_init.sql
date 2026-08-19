-- 商品診断アプリ用の初期スキーマ
-- 参考: docs/data-model.md

CREATE TABLE catalog_state (
  category_key TEXT PRIMARY KEY,
  active_version_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE catalog_versions (
  version_id TEXT PRIMARY KEY,
  category_key TEXT NOT NULL,
  source_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staging', 'valid', 'published', 'rejected')),
  item_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX idx_catalog_versions_category ON catalog_versions(category_key);

CREATE TABLE products (
  version_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  display_name TEXT NOT NULL,
  specs_json TEXT NOT NULL,
  availability TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (version_id, product_id)
);
CREATE INDEX idx_products_version ON products(version_id);
CREATE INDEX idx_products_category ON products(category_key);

CREATE TABLE product_offers (
  version_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  provider_item_id TEXT NOT NULL,
  outbound_url TEXT NOT NULL,
  price_minor INTEGER,
  currency TEXT,
  availability TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (version_id, product_id, provider_key)
);
CREATE INDEX idx_offers_version ON product_offers(version_id);

CREATE TABLE ingest_runs (
  run_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  category_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'rejected')),
  fetched_count INTEGER NOT NULL DEFAULT 0,
  normalized_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  candidate_version TEXT
);
