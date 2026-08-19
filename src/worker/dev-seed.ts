import type { Env } from "./env";
import { json } from "./http";
import { getAdapter, listAdapterCategories } from "./adapters";
import { runIngest } from "./ingest/run";

/**
 * ローカル開発/e2e専用：登録済み全カテゴリの手動キュレーションカタログを投入して公開する。
 * env.DEV_SEED === "1" のときのみ有効。本番ワーカーには設定しない。
 */
export async function handleDevSeed(env: Env): Promise<Response> {
  const results = [];
  for (const categoryKey of listAdapterCategories()) {
    const adapter = getAdapter(categoryKey);
    const summary = await runIngest(env, adapter, categoryKey, new Date());
    results.push({
      categoryKey,
      runId: summary.runId,
      status: summary.status,
      versionId: summary.versionId,
      normalizedCount: summary.normalizedCount,
      gates: summary.gates.map((g) => ({ name: g.name, pass: g.pass, message: g.message })),
      errorSummary: summary.errorSummary,
    });
  }
  return json({ results });
}
