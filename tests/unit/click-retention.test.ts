import { describe, expect, it } from "vitest";
import {
  CLICK_RETENTION_DAYS,
  cleanupExpiredClicks,
  isDuplicateClick,
  recordClickTimestamp,
} from "../../src/worker/click-retention";

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

describe("per-user click dedup", () => {
  function makeKvStore() {
    const store = new Map<string, { value: string; ttl?: number }>();
    return {
      store,
      async get(key: string) {
        return store.get(key)?.value ?? null;
      },
      async put(key: string, value: string, opts?: { expirationTtl?: number }) {
        store.set(key, { value, ttl: opts?.expirationTtl });
      },
    } as unknown as KVNamespace & { store: typeof store };
  }

  function makeRequest(ip = "1.2.3.4", ua = "TestBrowser/1.0") {
    return new Request("http://localhost/go/rakuten/token", {
      headers: {
        "cf-connecting-ip": ip,
        "user-agent": ua,
      },
    });
  }

  it("同一ユーザー同一offerの連続クリックはデュープ扱い", async () => {
    const kv = makeKvStore();
    const req = makeRequest();

    expect(await isDuplicateClick({ KV: kv } as never, "rakuten", "item-1", req)).toBe(false);
    await recordClickTimestamp({ KV: kv } as never, "rakuten", "item-1", req);
    expect(await isDuplicateClick({ KV: kv } as never, "rakuten", "item-1", req)).toBe(true);
  });

  it("異なるユーザー同一offerはデュープ扱いしない", async () => {
    const kv = makeKvStore();
    const reqA = makeRequest("1.1.1.1", "BrowserA");
    const reqB = makeRequest("2.2.2.2", "BrowserB");

    expect(await isDuplicateClick({ KV: kv } as never, "rakuten", "item-1", reqA)).toBe(false);
    await recordClickTimestamp({ KV: kv } as never, "rakuten", "item-1", reqA);
    // 異なるIP+UA → 異なるフィンガープリント → デュープしない
    expect(await isDuplicateClick({ KV: kv } as never, "rakuten", "item-1", reqB)).toBe(false);
  });

  it("同一ユーザーでも異なるofferはデュープ扱いしない", async () => {
    const kv = makeKvStore();
    const req = makeRequest();

    await recordClickTimestamp({ KV: kv } as never, "rakuten", "item-1", req);
    expect(await isDuplicateClick({ KV: kv } as never, "rakuten", "item-2", req)).toBe(false);
  });

  it("KV障害時はデュープチェックをスキップ", async () => {
    const brokenKv = {
      async get() {
        throw new Error("KV down");
      },
    } as unknown as KVNamespace;
    const req = makeRequest();

    expect(await isDuplicateClick({ KV: brokenKv } as never, "rakuten", "item-1", req)).toBe(false);
  });
});
