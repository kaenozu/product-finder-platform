-- プライバシー最小化: click_events から PII（referer / user_agent / ip_hash）を削除する。
-- クリック計測は商品・バージョン・時刻の最小限のみ保持する。
ALTER TABLE click_events DROP COLUMN referer;
ALTER TABLE click_events DROP COLUMN user_agent;
ALTER TABLE click_events DROP COLUMN ip_hash;