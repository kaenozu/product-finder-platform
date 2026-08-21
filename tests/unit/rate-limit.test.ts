/**
 * Issue #26: rate limit・bot耐性・retention の回帰テスト。
 *
 * 受入条件:
 * - rate limit超過時のHTTP status・Retry-After等の契約
 * - /go の bot アクセスで click_events を無制限に増やさない対策
 * - click分析用途のイベントと機械的アクセスの分離
 * - click_events のretention/集約/削除ポリシー
 */
import { describe, expect, it, vi } from "vitest";
import { RATE_LIMITS, checkRateLimit, getRateLimitConfig } from "../../src/worker/rate-limit";
import {
  isLikelyBot,
  CLICK_RETENTION_DAYS,
  CLICK_DEDUP_WINDOW_MS,
} from "../../src/worker/click-retention";

// ──────────────────────────────────────────────
// Rate limit config
// ──────────────────────────────────────────────

describe("rate limit configuration", () => {
  it("/go には rate limit が設定されている", () => {
    expect(RATE_LIMITS["/go"]).toBeDefined();
    expect(RATE_LIMITS["/go"]!.maxRequests).toBeGreaterThan(0);
    expect(RATE_LIMITS["/go"]!.windowMs).toBeGreaterThan(0);
  });

  it("/img には rate limit が設定されている", () => {
    expect(RATE_LIMITS["/img"]).toBeDefined();
    expect(RATE_LIMITS["/img"]!.maxRequests).toBeGreaterThan(0);
  });

  it("/api/diagnosis/evaluate には rate limit が設定されている", () => {
    expect(RATE_LIMITS["/api/diagnosis/evaluate"]).toBeDefined();
    expect(RATE_LIMITS["/api/diagnosis/evaluate"]!.maxRequests).toBeGreaterThan(0);
  });

  it("全ての rate limit に retryAfterSeconds が設定されている", () => {
    for (const [path, config] of Object.entries(RATE_LIMITS)) {
      expect(config.retryAfterSeconds, `${path} に retryAfterSeconds がない`).toBeGreaterThan(0);
    }
  });
});

// ──────────────────────────────────────────────
// getRateLimitConfig
// ──────────────────────────────────────────────

describe("getRateLimitConfig", () => {
  it("/go にマッチする", () => {
    const result = getRateLimitConfig("/go");
    expect(result).toBeDefined();
    expect(result!.path).toBe("/go");
  });

  it("/go/some-token にマッチする", () => {
    const result = getRateLimitConfig("/go/rakuten/some-token");
    expect(result).toBeDefined();
    expect(result!.path).toBe("/go");
  });

  it("/img にマッチする", () => {
    const result = getRateLimitConfig("/img");
    expect(result).toBeDefined();
    expect(result!.path).toBe("/img");
  });

  it("/api/diagnosis/evaluate にマッチする", () => {
    const result = getRateLimitConfig("/api/diagnosis/evaluate");
    expect(result).toBeDefined();
    expect(result!.path).toBe("/api/diagnosis/evaluate");
  });

  it("/api/health にはマッチしない", () => {
    const result = getRateLimitConfig("/api/health");
    expect(result).toBeUndefined();
  });

  it("/api/ready にはマッチしない", () => {
    const result = getRateLimitConfig("/api/ready");
    expect(result).toBeUndefined();
  });

  it("/unknown にはマッチしない", () => {
    const result = getRateLimitConfig("/unknown");
    expect(result).toBeUndefined();
  });
});

// ──────────────────────────────────────────────
// checkRateLimit (with mock KV)
// ──────────────────────────────────────────────

describe("checkRateLimit", () => {
  function createMockKV(): KVNamespace {
    const store = new Map<string, string>();
    return {
      get: vi.fn().mockImplementation(async (key: string) => store.get(key) ?? null),
      put: vi.fn().mockImplementation(async (key: string, value: string) => {
        store.set(key, value);
      }),
      delete: vi.fn().mockImplementation(async (key: string) => {
        store.delete(key);
      }),
    } as unknown as KVNamespace;
  }

  function createRequest(path: string, ip = "1.2.3.4"): Request {
    return new Request(`https://example.com${path}`, {
      headers: { "CF-Connecting-IP": ip },
    });
  }

  it("上限以内のリクエストは許可する", async () => {
    const kv = createMockKV();
    const config = RATE_LIMITS["/go"]!;

    const result = await checkRateLimit(createRequest("/go"), "/go", kv, config);
    expect(result.allowed).toBe(true);
    expect(result.response).toBeUndefined();
  });

  it("上限超過のリクエストは 429 で拒否する", async () => {
    const kv = createMockKV();
    const config = RATE_LIMITS["/go"]!;

    // 上限までカウンタをインクリメント
    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit(createRequest("/go"), "/go", kv, config);
    }

    // 上限超過
    const result = await checkRateLimit(createRequest("/go"), "/go", kv, config);
    expect(result.allowed).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(429);
  });

  it("429 レスポンスに Retry-After ヘッダーが含まれる", async () => {
    const kv = createMockKV();
    const config = RATE_LIMITS["/go"]!;

    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit(createRequest("/go"), "/go", kv, config);
    }

    const result = await checkRateLimit(createRequest("/go"), "/go", kv, config);
    expect(result.response!.headers.get("Retry-After")).toBeTruthy();
  });

  it("429 レスポンスに X-RateLimit-* ヘッダーが含まれる", async () => {
    const kv = createMockKV();
    const config = RATE_LIMITS["/go"]!;

    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit(createRequest("/go"), "/go", kv, config);
    }

    const result = await checkRateLimit(createRequest("/go"), "/go", kv, config);
    expect(result.response!.headers.get("X-RateLimit-Limit")).toBeTruthy();
    expect(result.response!.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(result.response!.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("異なる IP は別々にカウントする", async () => {
    const kv = createMockKV();
    const config = RATE_LIMITS["/go"]!;

    // IP 1 を上限まで
    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit(createRequest("/go", "1.1.1.1"), "/go", kv, config);
    }

    // IP 2 はまだ上限未到達
    const result = await checkRateLimit(createRequest("/go", "2.2.2.2"), "/go", kv, config);
    expect(result.allowed).toBe(true);
  });

  it("KV障害時は rate limit をスキップ", async () => {
    const kv = {
      get: vi.fn().mockRejectedValue(new Error("KV error")),
      put: vi.fn().mockRejectedValue(new Error("KV error")),
    } as unknown as KVNamespace;
    const config = RATE_LIMITS["/go"]!;

    const result = await checkRateLimit(createRequest("/go"), "/go", kv, config);
    expect(result.allowed).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Bot detection
// ──────────────────────────────────────────────

describe("isLikelyBot", () => {
  it("headless ブラウザを検出する", () => {
    const req = new Request("https://example.com/go", {
      headers: { "user-agent": "Mozilla/5.0 HeadlessChrome/100.0.0.0" },
    });
    expect(isLikelyBot(req)).toBe(true);
  });

  it("bot User-Agent を検出する", () => {
    const req = new Request("https://example.com/go", {
      headers: { "user-agent": "Googlebot/2.1" },
    });
    expect(isLikelyBot(req)).toBe(true);
  });

  it("curl を検出する", () => {
    const req = new Request("https://example.com/go", {
      headers: { "user-agent": "curl/7.88.1" },
    });
    expect(isLikelyBot(req)).toBe(true);
  });

  it("正常なブラウザは bot とみなさない", () => {
    const req = new Request("https://example.com/go", {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });
    expect(isLikelyBot(req)).toBe(false);
  });

  it("User-Agent なしは bot とみなさない", () => {
    const req = new Request("https://example.com/go");
    expect(isLikelyBot(req)).toBe(false);
  });
});

// ──────────────────────────────────────────────
// Retention policy
// ──────────────────────────────────────────────

describe("click retention policy", () => {
  it("CLICK_RETENTION_DAYS は 90 日", () => {
    expect(CLICK_RETENTION_DAYS).toBe(90);
  });

  it("CLICK_DEDUP_WINDOW_MS は 5 秒", () => {
    expect(CLICK_DEDUP_WINDOW_MS).toBe(5_000);
  });
});
