CREATE TABLE click_events (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  provider_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  version_id TEXT,
  clicked_at TEXT NOT NULL,
  referer TEXT,
  user_agent TEXT,
  ip_hash TEXT
);
CREATE INDEX idx_click_events_product ON click_events(product_id);
CREATE INDEX idx_click_events_provider ON click_events(provider_key);