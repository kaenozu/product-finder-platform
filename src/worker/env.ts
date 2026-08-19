export interface Env {
  DB: D1Database;
  /** ローカル開発/e2e専用。本番には設定しないこと（/api/dev/seed の有効化） */
  DEV_SEED?: string;
}
