#!/usr/bin/env node
/**
 * catalog rollback CLI — setActiveVersion の運用手続き。
 *
 * Production D1 の catalog_state.active_version_id を指定バージョンへ切り替え、
 * 壊れたカタログを直前の良好なバージョンへ戻す（docs/production-smoke-runbook.md
 * の rollback pair 記録と対で使う）。
 *
 * 使い方:
 *   node scripts/catalog-rollback.mjs --category rice-cooker --version <version_id> [--execute]
 *
 * 既定は dry-run（実行SQLの表示のみ）。--execute で実際に適用する。
 * version_id は `wrangler d1 execute product-finder-platform --remote --command
 *   "SELECT version_id, status, created_at FROM catalog_versions WHERE category_key='rice-cooker' ORDER BY created_at DESC"`
 * で確認できる。
 */
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";

const { values } = parseArgs({
  options: {
    category: { type: "string" },
    version: { type: "string" },
    execute: { type: "boolean", default: false },
    database: { type: "string", default: "product-finder-platform" },
  },
});

if (!values.category || !values.version) {
  console.error(
    "Usage: node scripts/catalog-rollback.mjs --category <key> --version <version_id> [--execute]"
  );
  process.exit(2);
}

const sql =
  `INSERT OR REPLACE INTO catalog_state (category_key, active_version_id, updated_at) ` +
  `VALUES ('${values.category}', '${values.version}', datetime('now'));`;

console.log(`[catalog-rollback] category=${values.category}`);
console.log(`[catalog-rollback] target version=${values.version}`);
console.log(`[catalog-rollback] SQL:\n${sql}\n`);

if (!values.execute) {
  console.log("[catalog-rollback] dry-run。適用するには --execute を付けて再実行してください。");
  process.exit(0);
}

try {
  const output = execFileSync(
    "wrangler",
    ["d1", "execute", values.database, "--remote", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  console.log(output);
  console.log("[catalog-rollback] done。/api/ready と smoke で公開状態を確認すること。");
} catch {
  console.error(
    "[catalog-rollback] wrangler d1 execute に失敗しました。認証とdatabase名を確認してください。"
  );
  process.exit(1);
}
