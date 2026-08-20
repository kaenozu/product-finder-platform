-- ingest のコンテンツハッシュ（同一データの再取り込みをスキップするための no-op 検出）
ALTER TABLE ingest_runs ADD COLUMN content_hash TEXT;