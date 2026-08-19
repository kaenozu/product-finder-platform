-- 商品にカタログ参考価格列を追加（DB復元後も referencePriceYen を保持できるようにする）
ALTER TABLE products ADD COLUMN reference_price_yen INTEGER;