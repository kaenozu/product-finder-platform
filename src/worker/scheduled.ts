import type { Env } from "./env";
import { getAdapter, listAdapterCategories } from "./adapters";
import { runIngest, type IngestSummary } from "./ingest/run";

export type ScheduledCategoryStatus = IngestSummary["status"] | "failed";

export interface ScheduledCategoryResult {
  categoryKey: string;
  status: ScheduledCategoryStatus;
  runId: string | null;
  errorSummary?: string;
}

export interface ScheduledRunSummary {
  runId: string;
  status: "succeeded" | "partial_failure" | "failed";
  categories: ScheduledCategoryResult[];
  counts: {
    succeeded: number;
    skipped: number;
    rejected: number;
    failed: number;
  };
}

export function summarizeScheduledResults(
  runId: string,
  categories: ScheduledCategoryResult[]
): ScheduledRunSummary {
  const counts = {
    succeeded: categories.filter((result) => result.status === "succeeded").length,
    skipped: categories.filter((result) => result.status === "skipped").length,
    rejected: categories.filter((result) => result.status === "rejected").length,
    failed: categories.filter((result) => result.status === "failed").length,
  };
  const abnormal = counts.rejected + counts.failed;
  return {
    runId,
    status:
      abnormal === 0
        ? "succeeded"
        : counts.succeeded + counts.skipped === 0
          ? "failed"
          : "partial_failure",
    categories,
    counts,
  };
}

/**
 * 毎日のバッチ処理（cron）。
 * 実行時刻: UTC 03:00 = JST 12:00 (noon)。
 * Cloudflare Cron Triggers は UTC 基準。wrangler.cron.jsonc の `0 3 * * *` に対応。
 * 全カテゴリを処理し、カテゴリ単位の失敗を集計したうえで、異常時は例外化してcronを成功扱いにしない。
 */
export async function handleScheduled(
  controller: ScheduledController,
  env: Env
): Promise<ScheduledRunSummary> {
  const runId = crypto.randomUUID();
  const now = new Date();
  const categories: ScheduledCategoryResult[] = [];

  for (const categoryKey of listAdapterCategories()) {
    try {
      const adapter = getAdapter(categoryKey);
      const summary = await runIngest(env, adapter, categoryKey, now);
      categories.push({
        categoryKey,
        status: summary.status,
        runId: summary.runId,
        errorSummary: summary.errorSummary,
      });
      console.log(
        `[scheduled] runId=${runId} category=${categoryKey} status=${summary.status} ` +
          `ingestRunId=${summary.runId} products=${summary.normalizedCount} ` +
          `version=${summary.versionId ?? "-"} ` +
          (summary.errorSummary ? `error=${summary.errorSummary}` : "")
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      categories.push({ categoryKey, status: "failed", runId: null, errorSummary: message });
      console.error(`[scheduled] runId=${runId} category=${categoryKey} failed: ${message}`);
    }
  }

  const result = summarizeScheduledResults(runId, categories);
  console.log(
    `[scheduled] runId=${runId} result=${result.status} ` +
      `succeeded=${result.counts.succeeded} skipped=${result.counts.skipped} ` +
      `rejected=${result.counts.rejected} failed=${result.counts.failed}`
  );
  void controller;

  if (result.status !== "succeeded") {
    throw new Error(
      `[scheduled] runId=${runId} result=${result.status} ` +
        `rejected=${result.counts.rejected} failed=${result.counts.failed}`
    );
  }
  return result;
}
