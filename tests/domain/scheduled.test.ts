import { describe, expect, it } from "vitest";
import { summarizeScheduledResults } from "../../src/worker/scheduled";

describe("scheduled ingest outcome", () => {
  it("全カテゴリ成功・skipはcron成功", () => {
    const result = summarizeScheduledResults("run-1", [
      { categoryKey: "rice-cooker", status: "succeeded", runId: "ingest-1" },
      { categoryKey: "water-bottle", status: "skipped", runId: "ingest-2" },
    ]);

    expect(result).toMatchObject({
      runId: "run-1",
      status: "succeeded",
      counts: { succeeded: 1, skipped: 1, rejected: 0, failed: 0 },
    });
  });

  it("一部失敗はpartial_failureとして集計する", () => {
    const result = summarizeScheduledResults("run-2", [
      { categoryKey: "rice-cooker", status: "succeeded", runId: "ingest-1" },
      { categoryKey: "water-bottle", status: "rejected", runId: "ingest-2", errorSummary: "gate" },
    ]);

    expect(result.status).toBe("partial_failure");
    expect(result.counts.rejected).toBe(1);
  });

  it("全カテゴリ失敗はfailedとして集計する", () => {
    const result = summarizeScheduledResults("run-3", [
      { categoryKey: "rice-cooker", status: "failed", runId: null, errorSummary: "D1" },
      { categoryKey: "water-bottle", status: "rejected", runId: "ingest-2", errorSummary: "gate" },
    ]);

    expect(result.status).toBe("failed");
    expect(result.counts).toEqual({ succeeded: 0, skipped: 0, rejected: 1, failed: 1 });
  });

  it("retention cleanupの失敗・残件をingest結果と分離して監査できる", () => {
    const result = summarizeScheduledResults(
      "run-4",
      [{ categoryKey: "rice-cooker", status: "succeeded", runId: "ingest-4" }],
      { deleted: 1000, errors: 0, hasMore: true }
    );

    expect(result.status).toBe("succeeded");
    expect(result.counts.succeeded).toBe(1);
    expect(result.retention).toEqual({ deleted: 1000, errors: 0, hasMore: true });
  });
});
