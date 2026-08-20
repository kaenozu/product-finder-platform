/**
 * e2e/ローカル確認用サーバー起動スクリプト。
 * 1) ローカルD1へmigration適用
 * 2) wrangler dev を起動（DEV_SEED=1）
 * 3) /api/health の応答を待つ
 * 4) /api/dev/seed をPOSTしてカタログを公開
 * 5) サーバーが終了するまで維持（Ctrl+C / SIGTERM で子プロセスを終了）
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { resolvePnpmCommand } from "./pnpm-command.mjs";

const portValue = process.env.PORT ?? "8787";
const portNumber = Number(portValue);
if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
  throw new Error(`invalid PORT: ${portValue}`);
}
const PORT = String(portNumber);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function runOnce(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    p.on("error", reject);
  });
}

async function waitForHealth() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await delay(500);
  }
  throw new Error("wrangler dev did not become healthy in time");
}

const build = resolvePnpmCommand(["build"]);
await runOnce(build.command, build.args);
const migrate = resolvePnpmCommand([
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "product-finder-platform",
  "--local",
]);
await runOnce(migrate.command, migrate.args);

const devCommand = resolvePnpmCommand(["wrangler", "dev", "--port", PORT, "--var", "DEV_SEED:1"]);
const dev = spawn(devCommand.command, devCommand.args, {
  stdio: "inherit",
});

dev.on("exit", (code) => process.exit(code ?? 0));
dev.on("error", (err) => {
  console.error("[e2e-server] wrangler dev failed:", err);
  process.exit(1);
});
process.on("SIGTERM", () => dev.kill());
process.on("SIGINT", () => dev.kill());

try {
  await waitForHealth();
  const seed = await fetch(`${BASE}/api/dev/seed`, { method: "POST" });
  if (!seed.ok) {
    const text = await seed.text();
    throw new Error(`seed failed: ${seed.status} ${text}`);
  }
  /**
   * @typedef {{ status?: string, normalizedCount?: number, versionId?: string | null }} SeedResult
   * @typedef {SeedResult & { results?: SeedResult[] }} SeedSummary
   */
  const summary = /** @type {SeedSummary} */ (await seed.json());
  const first = summary.results?.[0] ?? summary;
  console.log(
    `[e2e-server] seeded catalog: ${first.status} products=${first.normalizedCount} version=${first.versionId ?? "-"}`
  );
} catch (err) {
  console.error("[e2e-server]", err);
  dev.kill();
  process.exit(1);
}

console.log(`[e2e-server] ready at ${BASE}`);
