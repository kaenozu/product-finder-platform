import type { Env } from "./env";
import { json } from "./http";
import { runIngest } from "./ingest/run";
import { ManualRiceCookerAdapter } from "./adapters/manual";

/**
 * ローカル開発/e2e専用：D1へ手動キュレーションカタログを投入して公開する。
 * env.DEV_SEED === "1" のときのみ有効。本番ワーカーには設定しない。
 */
export async function handleDevSeed(env: Env): Promise<Response> {
  const adapter = new ManualRiceCookerAdapter();
  const summary = await runIngest(env, adapter, "rice-cooker", new Date());
  return json({
    runId: summary.runId,
    status: summary.status,
    versionId: summary.versionId,
    normalizedCount: summary.normalizedCount,
    gates: summary.gates.map((g) => ({ name: g.name, pass: g.pass, message: g.message })),
    errorSummary: summary.errorSummary,
  });
}
