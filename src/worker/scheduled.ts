import type { Env } from "./env";
import { ManualRiceCookerAdapter } from "./adapters/manual";
import { runIngest } from "./ingest/run";

/**
 * 毎日3時のバッチ処理（cron）。
 * 手動キュレーションデータを再検証し、品質ゲートを通過したら公開する。
 */
export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const categoryKey = "rice-cooker";
  const adapter = new ManualRiceCookerAdapter();
  const summary = await runIngest(env, adapter, categoryKey, new Date());
  console.log(
    `[scheduled] category=${categoryKey} status=${summary.status} runId=${summary.runId} ` +
      `products=${summary.normalizedCount} version=${summary.versionId ?? "-"} ` +
      (summary.errorSummary ? `error=${summary.errorSummary}` : "")
  );
  void controller;
}
