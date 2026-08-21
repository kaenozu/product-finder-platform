import { describe, expect, it } from "vitest";
import { CLICK_RETENTION_DAYS, cleanupExpiredClicks } from "../../src/worker/click-retention";

type QueryResult = { results: Array<{ id: string }> };

function makeDb(batches: QueryResult[]) {
  const queries: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    queries,
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          queries.push({ sql, bindings });
          return {
            async all<T>() {
              return batches.shift() as QueryResult as { results: T[] };
            },
            async run() {
              return {};
            },
          };
        },
      };
    },
  } as unknown as D1Database & { queries: typeof queries };
}

describe("click event retention", () => {
  it("deletes expired rows in bounded batches and leaves newer rows untouched", async () => {
    const db = makeDb([
      { results: Array.from({ length: 100 }, (_, i) => ({ id: `old-${i}` })) },
      { results: [{ id: "old-100" }] },
      { results: [] },
    ]);

    const result = await cleanupExpiredClicks({ DB: db });

    expect(result).toEqual({ deleted: 101, errors: 0, hasMore: false });
    expect(db.queries.filter((query) => query.sql.startsWith("DELETE")).length).toBe(2);
    const cutoff = Date.parse(String(db.queries[0]?.bindings[0]));
    expect(cutoff).toBeGreaterThan(Date.now() - (CLICK_RETENTION_DAYS + 1) * 86_400_000);
    expect(cutoff).toBeLessThan(Date.now() - (CLICK_RETENTION_DAYS - 1) * 86_400_000);
  });

  it("reports remaining expired rows when the per-run cap is reached", async () => {
    const db = makeDb(
      Array.from({ length: 11 }, () => ({
        results: Array.from({ length: 100 }, (_, i) => ({ id: `${i}` })),
      }))
    );

    const result = await cleanupExpiredClicks({ DB: db });

    expect(result).toEqual({ deleted: 1000, errors: 0, hasMore: true });
  });
});
