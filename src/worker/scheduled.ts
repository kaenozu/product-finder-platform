import type { Env } from "./env";
import { getAdapter, listAdapterCategories } from "./adapters";
import { runIngest } from "./ingest/run";

/**
 * 毎日3時のバッチ処理（cron）。
 * 登録済み全カテゴリの手動キュレーションデータを再検証し、品質ゲートを通過したら公開する。
 */
export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const now = new Date();
  for (const categoryKey of listAdapterCategories()) {
    try {
      const adapter = getAdapter(categoryKey);
      const summary = await runIngest(env, adapter, categoryKey, now);
      console.log(
        `[scheduled] category=${categoryKey} status=${summary.status} runId=${summary.runId} ` +
          `products=${summary.normalizedCount} version=${summary.versionId ?? "-"} ` +
          (summary.errorSummary ? `error=${summary.errorSummary}` : "")
      );
    } catch (e) {
      console.error(`[scheduled] category=${categoryKey} failed: ${String(e)}`);
    }
  }
  void controller;
}
