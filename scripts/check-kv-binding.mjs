#!/usr/bin/env node
// wrangler設定のKV bindingを検証する。
//
// handler.tsはKV未bind時に主要APIを503でfail-closedする。Dashboard管理に
// 依存したままではデプロイ毎の設定ドリフトでサイト全体が無機能化するため、
// デプロイ前にこのスクリプトでbinding宣言と実IDの設定を強制する。
//
// 使い方: node scripts/check-kv-binding.mjs
// 環境変数 ALLOW_DASHBOARD_MANAGED_KV=1 で「Dashboard管理継続」の意思表示
// をした場合のみ、kv_namespaces未宣言を許容する(警告表示)。

import { readFileSync } from "node:fs";

/**
 * @param {string} path
 * @returns {any}
 */
function parseJsonc(path) {
  const raw = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  // CRLFを正規化してからコメントを除去する(行末CRがline commentの$を阻害する)。
  const normalized = raw.replace(/\r\n/g, "\n");
  // 行/ブロックコメントを除去してからJSONとして解釈する。
  const withoutBlock = normalized.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLine = withoutBlock
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
  // JSONCが許容するtrailing commaを除去してから解釈する。
  return JSON.parse(withoutLine.replace(/,(\s*[}\]])/g, "$1"));
}

const UUID_LIKE = /^[0-9a-fA-F-]{20,}$/;
const configs = ["wrangler.jsonc", "wrangler.worker.jsonc"];
let failed = false;
let declaredAnywhere = false;

for (const config of configs) {
  const parsed = parseJsonc(config);
  const namespaces = /** @type {Array<{binding: string, id?: string}>} */ (
    parsed.kv_namespaces ?? []
  );
  const kvBinding = namespaces.find((ns) => ns.binding === "KV");
  if (!kvBinding) {
    console.warn(
      `[warn] ${config}: KV binding が未宣言です。` +
        "rate limit / click dedup が fail-closed (503) になります。"
    );
    continue;
  }
  declaredAnywhere = true;
  if (!UUID_LIKE.test(kvBinding.id ?? "")) {
    console.error(
      `[error] ${config}: kv_namespaces の binding "KV" に実際の namespace id ` +
        "が設定されていません。`npx wrangler kv namespace create RATE_LIMIT` で " +
        "id を取得し、設定を埋めてください。"
    );
    failed = true;
  } else {
    console.log(`[ok] ${config}: KV binding (id=${kvBinding.id}) を確認しました。`);
  }
}

if (!declaredAnywhere && process.env.ALLOW_DASHBOARD_MANAGED_KV === "1") {
  console.warn(
    "[warn] ALLOW_DASHBOARD_MANAGED_KV=1 のため Dashboard 管理を許可します。" +
      "deploy 前に Dashboard 側で KV binding が存在することを確認してください。"
  );
  process.exit(0);
}

if (failed || (!declaredAnywhere && process.env.CI === "true")) {
  process.exit(1);
}
