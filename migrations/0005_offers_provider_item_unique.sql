-- 同一バージョン内で同じ provider_item_id が複数商品に紐づくのを防ぐ。
-- /go は (provider_key, provider_item_id) で一意解決を前提とし、重複があると
-- LIMIT 2 の安全弁で購入CTA全体が404化する。バージョンが異なる再登録は許可する。
CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_provider_item_unique
  ON product_offers (version_id, provider_key, provider_item_id);
