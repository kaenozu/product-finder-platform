import { describe, expect, it } from "vitest";
import {
  CLICK_DEDUP_SALT_KEY_PREFIX,
  CLICK_DEDUP_SALT_TTL_SECONDS,
  CLICK_RETENTION_DAYS,
  computeDedupIdentifier,
  cleanupExpiredClicks,
  getDailySalt,
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

describe("salted dedup identifier (Issue #64)", () => {
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

  it("日次saltはKVにTTL48時間で保存され、再利用される", async () => {
    const kv = makeKvStore();
    const day = new Date("2026-08-24T09:00:00.000Z");

    const salt = await getDailySalt({ KV: kv }, day);
    expect(salt).toMatch(/^[0-9a-f-]{36}$/);

    const stored = kv.store.get(`${CLICK_DEDUP_SALT_KEY_PREFIX}:2026-08-24`);
    expect(stored?.value).toBe(salt);
    expect(stored?.ttl).toBe(CLICK_DEDUP_SALT_TTL_SECONDS);
    expect(CLICK_DEDUP_SALT_TTL_SECONDS).toBe(172_800);

    // 同日の2回目は同じsaltを使い回す（上書きしない）
    const again = await getDailySalt({ KV: kv }, new Date("2026-08-24T23:59:59.000Z"));
    expect(again).toBe(salt);
  });

  it("識別子は同一ユーザー同一日内で不変", async () => {
    const kv = makeKvStore();
    const req = makeRequest();

    const a = await computeDedupIdentifier({ KV: kv }, req, new Date("2026-08-24T00:00:01.000Z"));
    const b = await computeDedupIdentifier({ KV: kv }, req, new Date("2026-08-24T23:59:59.000Z"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it("異なるユーザーは同一日内でも異なる識別子になる", async () => {
    const kv = makeKvStore();
    const now = new Date("2026-08-24T12:00:00.000Z");

    const a = await computeDedupIdentifier({ KV: kv }, makeRequest("1.1.1.1", "BrowserA"), now);
    const b = await computeDedupIdentifier({ KV: kv }, makeRequest("2.2.2.2", "BrowserB"), now);
    expect(a).not.toBe(b);
  });

  it("UTC日付が変わるとsaltがローテートし、識別子は衝突しない", async () => {
    const kv = makeKvStore();
    const req = makeRequest();

    const day1 = new Date("2026-08-23T23:59:59.000Z");
    const day2 = new Date("2026-08-24T00:00:00.000Z");

    // 前日にクリックを記録しても、翌日はsaltが変わるためデュープ扱いしない
    await recordClickTimestamp({ KV: kv } as never, "rakuten", "item-1", req, day1);
    expect(await isDuplicateClick({ KV: kv } as never, "rakuten", "item-1", req, day1)).toBe(true);
    expect(await isDuplicateClick({ KV: kv } as never, "rakuten", "item-1", req, day2)).toBe(false);

    // saltキーは日付ごとに別エントリ
    expect(kv.store.has(`${CLICK_DEDUP_SALT_KEY_PREFIX}:2026-08-23`)).toBe(true);
    expect(kv.store.has(`${CLICK_DEDUP_SALT_KEY_PREFIX}:2026-08-24`)).toBe(true);
  });

  it("生のIP/UAはKVに一切保存されない", async () => {
    const kv = makeKvStore();
    const now = new Date("2026-08-24T12:00:00.000Z");
    const req = makeRequest("203.0.113.7", "SecretBrowser/9.9");

    await getDailySalt({ KV: kv }, now);
    await recordClickTimestamp({ KV: kv } as never, "rakuten", "item-1", req, now);

    for (const [key, entry] of kv.store) {
      expect(key).not.toContain("203.0.113.7");
      expect(key).not.toContain("SecretBrowser");
      expect(entry.value).not.toContain("203.0.113.7");
      expect(entry.value).not.toContain("SecretBrowser");
      // dedupキーにはsalt込みSHA-256のみが載る
      if (key.startsWith("click_dedup:")) {
        expect(key).toMatch(/^click_dedup:[0-9a-f]{64}:rakuten:item-1$/);
      }
    }
  });

  it("salt取得のKV障害時も識別子生成自体は失敗しない（fail-open）", async () => {
    const brokenKv = {
      async get() {
        throw new Error("KV down");
      },
    } as unknown as KVNamespace;

    const id = await computeDedupIdentifier(
      { KV: brokenKv },
      makeRequest(),
      new Date("2026-08-24T12:00:00.000Z")
    );
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});
