export interface Env {
  DB: D1Database;
  /** Rate limit / dedup 用 KV namespace */
  KV?: KVNamespace;
  /** カンマ区切りの公開有効カテゴリキー。未設定なら全カテゴリを有効とする。 */
  ENABLED_CATEGORIES?: string;
  /** ローカル開発/e2e専用。本番には設定しないこと（/api/dev/seed の有効化） */
  DEV_SEED?: string;
  /** ローカル開発専用。KV未設定時のrate limit fail-closedを回避 */
  RATE_LIMIT_BYPASS?: string;
}
