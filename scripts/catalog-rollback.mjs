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

// SQL文字列連結によるインジェクションとtypo爆発を防ぐため、引数は
// カタログ識別子の字種に限定して検証する。
const CATEGORY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^[a-zA-Z0-9_-]{1,64}$/;
if (!CATEGORY_RE.test(values.category)) {
  console.error(
    `[catalog-rollback] invalid --category: ${values.category} (expected lowercase slug)`
  );
  process.exit(2);
}
if (!VERSION_RE.test(values.version)) {
  console.error(
    `[catalog-rollback] invalid --version: ${values.version} (expected version id)`
  );
  process.exit(2);
}

// 実行前に対象versionの存在とカテゴリ帰属を確認する。存在しないversionへの
// 切り替えはcatalog_stateを壊すため、dry-run/executeともに行う。
const verifySql =
  `SELECT version_id, category_key, status FROM catalog_versions ` +
  `WHERE version_id = '${values.version}' AND category_key = '${values.category}';`;

try {
  const verified = execFileSync(
    "wrangler",
    ["d1", "execute", values.database, "--remote", "--command", verifySql, "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  const rows = JSON.parse(verified)?.[0]?.results ?? [];
  if (rows.length !== 1) {
    console.error(
      `[catalog-rollback] version ${values.version} not found for category ${values.category}。` +
        "READMEの手順で catalog_versions を確認してください。"
    );
    process.exit(1);
  }
  if (rows[0].status === "active") {
    console.log("[catalog-rollback] target version is already active。何もしない。");
    process.exit(0);
  }
} catch {
  console.error(
    "[catalog-rollback] wrangler d1 execute に失敗しました。認証とdatabase名を確認してください。"
  );
  process.exit(1);
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
