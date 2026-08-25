#!/usr/bin/env node
// @ts-check
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
 */
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";

const IDENTIFIER_PATTERN = /^[a-z0-9-]+$/;

/** @typedef {{ category?: string, version?: string, database?: string }} RollbackInput */
/** @typedef {{ version_id: string, category_key: string, status: string }} CatalogVersionRow */

/** @param {RollbackInput} input */
export function validateRollbackInput({ category, version, database }) {
  for (const [name, value] of [
    ["category", category],
    ["version", version],
    ["database", database],
  ]) {
    if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
      throw new Error(`${name} は英数字小文字とハイフンのみで指定してください`);
    }
  }
  return { category, version, database };
}

/** @param {string} category @param {string} version */
export function buildRollbackSql(category, version) {
  return (
    "INSERT INTO catalog_state (category_key, active_version_id, updated_at) " +
    `SELECT '${category}', '${version}', datetime('now') ` +
    "WHERE EXISTS (SELECT 1 FROM catalog_versions " +
    `WHERE version_id = '${version}' AND category_key = '${category}' ` +
    "AND status IN ('valid', 'published')) " +
    "ON CONFLICT(category_key) DO UPDATE SET " +
    "active_version_id = excluded.active_version_id, updated_at = excluded.updated_at;"
  );
}

/** @param {string} output @returns {CatalogVersionRow[]} */
export function parseCatalogVersionRows(output) {
  const parsed = JSON.parse(output);
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  return batches.flatMap((batch) => (Array.isArray(batch?.results) ? batch.results : []));
}

/** @param {string} database @param {string} sql */
function runWrangler(database, sql) {
  return execFileSync(
    "wrangler",
    ["d1", "execute", database, "--remote", "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
}

function main() {
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

  try {
    validateRollbackInput(values);
  } catch (error) {
    console.error(`[catalog-rollback] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  const lookupSql =
    "SELECT version_id, category_key, status FROM catalog_versions " +
    `WHERE version_id = '${values.version}' AND category_key = '${values.category}' ` +
    "AND status IN ('valid', 'published') LIMIT 1;";
  const sql = buildRollbackSql(values.category, values.version);

  console.log(`[catalog-rollback] category=${values.category}`);
  console.log(`[catalog-rollback] target version=${values.version}`);
  console.log(`[catalog-rollback] SQL:\n${sql}\n`);

  if (!values.execute) {
    console.log("[catalog-rollback] dry-run。適用するには --execute を付けて再実行してください。");
    process.exit(0);
  }

  try {
    const rows = parseCatalogVersionRows(runWrangler(values.database, lookupSql));
    if (rows.length !== 1) {
      throw new Error("対象versionが存在しないか、カテゴリ不一致または有効状態ではありません");
    }
    const output = runWrangler(values.database, sql);
    console.log(output);
    console.log("[catalog-rollback] done。/api/ready と smoke で公開状態を確認すること。");
  } catch (error) {
    console.error(`[catalog-rollback] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("catalog-rollback.mjs")) {
  main();
}
