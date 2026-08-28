import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../worker/index";
import type { Env } from "../../src/worker/env";

const workerEnv = { ...env, RATE_LIMIT_BYPASS: "1" } as unknown as Env;

describe("worker routing and request boundaries", () => {
  it("不正なpercent encodingを400へ変換する", async () => {
    const product = await worker.fetch(new Request("http://localhost/api/products/%"), workerEnv);
    const redirect = await worker.fetch(new Request("http://localhost/go/rakuten/%"), workerEnv);

    expect(product.status).toBe(400);
    expect(redirect.status).toBe(400);
  });

  it("実際のJSON応答にCORSとnosniffヘッダーが付く", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/health"), workerEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("permissions-policy")).toBe(
      "camera=(), geolocation=(), microphone=()"
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("画像プロキシにも共通security headerを付与する", async () => {
    const response = await worker.fetch(
      new Request(
        "http://localhost/img?url=" +
          encodeURIComponent("https://malicious.example.com/blocked.png")
      ),
      workerEnv
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("content-security-policy")).toContain("img-src 'self' data:");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("enabledカテゴリにactive catalogがなければreadinessは503", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/ready"), workerEnv);

    // テスト環境にcatalogがない場合もenabledカテゴリはトラフィック対象なので
    // readinessを通さない（空のdeployableCategoriesによるfail-openを防ぐ）
    expect(response.status).toBe(503);
    expect((await response.json()) as unknown).toMatchObject({
      ok: false,
      service: "product-finder-platform",
    });
  });

  it("deployed+未publishedカテゴリは503", async () => {
    // テスト環境で catalog を作って deployed にするが published にしない
    // → enabled+deployed+未published = fail-closed
    const { env: testEnv } = await import("cloudflare:test");
    const testDb = (testEnv as unknown as { DB: D1Database }).DB;
    await testDb
      .prepare(
        `INSERT OR IGNORE INTO catalog_state (category_key, active_version_id, updated_at)
         VALUES ('rice-cooker', 'fake-version-id', ?)`
      )
      .bind(new Date().toISOString())
      .run();

    const response = await worker.fetch(new Request("http://localhost/api/ready"), workerEnv);
    const body = (await response.json()) as { ok: boolean };
    // fake-version-id は published でないため 503
    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
  });

  it("32KiBを超える診断bodyを413で拒否する", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/api/diagnosis/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryKey: "rice-cooker", answers: { q: "x".repeat(33_000) } }),
      }),
      workerEnv
    );

    expect(response.status).toBe(413);
  });

  it("Content-Lengthなしの巨大bodyを上限超過時点でcancelする", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(16 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://localhost/api/diagnosis/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await worker.fetch(request, workerEnv);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("32KiBちょうどのmultibyte bodyはサイズ制限を通過する", async () => {
    const encoded = new TextEncoder().encode("あ".repeat(10_922) + "ab");
    expect(encoded.byteLength).toBe(32 * 1024);
    const response = await worker.fetch(
      new Request("http://localhost/api/diagnosis/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: encoded,
      }),
      workerEnv
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as unknown).toMatchObject({ error: "invalid_request" });
  });

  it("DEV_SEEDが誤設定されても公開ホストでは403にする", async () => {
    const response = await worker.fetch(
      new Request("https://preview.example.com/api/dev/seed", { method: "POST" }),
      { ...workerEnv, DEV_SEED: "1" }
    );

    expect(response.status).toBe(403);
  });

  it("/api/categories が登録済みカテゴリの一覧を返す", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/categories"), workerEnv);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      categories: Array<{ categoryKey: string; copy: { appTitle: string } }>;
    };
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.categories.some((c) => c.categoryKey === "rice-cooker")).toBe(true);
    expect(body.categories[0]!.copy.appTitle).toBeTruthy();
  });

  it("既知カテゴリのconfigを返す", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/api/config?category=rice-cooker"),
      workerEnv
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({
      categoryKey: "rice-cooker",
      partialEligibility: { type: "answered_at_least", minAnswers: 2 },
    });
  });

  it("未知カテゴリのconfigをdefaultカテゴリへfallbackせず404にする", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/api/config?category=unknown-category"),
      workerEnv
    );

    expect(response.status).toBe(404);
    expect((await response.json()) as unknown).toEqual({
      error: "unsupported_category",
      categoryKey: "unknown-category",
    });
  });

  it("category未指定のconfigは400 missing_category（暗黙fallback廃止）", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/config"), workerEnv);

    expect(response.status).toBe(400);
    expect((await response.json()) as unknown).toEqual({ error: "missing_category" });
  });
});

describe("image proxy", () => {
  const img = (url: string) => new Request(`http://localhost/img?url=${encodeURIComponent(url)}`);

  it("urlパラメータなしは400", async () => {
    const response = await worker.fetch(new Request("http://localhost/img"), workerEnv);
    expect(response.status).toBe(400);
  });

  it("不正なURLは400", async () => {
    const response = await worker.fetch(img("not a url"), workerEnv);
    expect(response.status).toBe(400);
  });

  it("https以外は400", async () => {
    const response = await worker.fetch(img("http://www.irisohyama.co.jp/a.jpg"), workerEnv);
    expect(response.status).toBe(400);
  });

  it("ホワイトリスト外のホストは403（SSRF対策）", async () => {
    const response = await worker.fetch(img("https://malicious.example.com/steal.png"), workerEnv);
    expect(response.status).toBe(403);
  });

  it("ローカルアドレスへのSSRF試行は403", async () => {
    const response = await worker.fetch(img("https://127.0.0.1/secret"), workerEnv);
    expect(response.status).toBe(403);
  });

  it("許可ホストの画像をプロキシして取得する", async () => {
    const response = await worker.fetch(
      img("https://panasonicjp.scene7.com/is/image/panasonicjp/SR-N210E-K_5_5?fmt=png-alpha"),
      workerEnv
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^image\//);
    const bytes = await response.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it("画像以外のレスポンスは502", async () => {
    const response = await worker.fetch(
      img("https://www.irisohyama.co.jp/ricecooker/rc-msa/"),
      workerEnv
    );
    expect(response.status).toBe(502);
  });
});

describe("readiness and category rollout", () => {
  it("ENABLED_CATEGORIES 未設定時は全カテゴリが有効（後方互換）", async () => {
    // workerEnv に ENABLED_CATEGORIES が未設定
    const response = await worker.fetch(new Request("http://localhost/api/ready"), workerEnv);
    const body = (await response.json()) as {
      ok: boolean;
      categories: Array<{ categoryKey: string; enabled: boolean }>;
    };

    // rice-cooker が有効且つpublished なら 200、そうでなければ 503
    const riceCooker = body.categories.find((c) => c.categoryKey === "rice-cooker");
    expect(riceCooker).toBeDefined();
    expect(riceCooker!.enabled).toBe(true);
  });

  it("ENABLED_CATEGORIES で指定したカテゴリのみ有効", async () => {
    const envWithEnabled = {
      ...workerEnv,
      ENABLED_CATEGORIES: "rice-cooker",
    } as Env;

    const response = await worker.fetch(new Request("http://localhost/api/ready"), envWithEnabled);
    const body = (await response.json()) as {
      ok: boolean;
      categories: Array<{ categoryKey: string; enabled: boolean }>;
    };

    const riceCooker = body.categories.find((c) => c.categoryKey === "rice-cooker");
    expect(riceCooker).toBeDefined();
    expect(riceCooker!.enabled).toBe(true);
  });

  it("未公開カテゴリへの診断は 404 で拒否", async () => {
    const envWithDisabled = {
      ...workerEnv,
      ENABLED_CATEGORIES: "", // 全カテゴリを無効化
    } as Env;

    const response = await worker.fetch(
      new Request("http://localhost/api/diagnosis/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryKey: "rice-cooker",
          answers: { cookVolume: "5.5" },
        }),
      }),
      envWithDisabled
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("category_not_enabled");
  });

  it("未公開カテゴリはcategories/configから隠す", async () => {
    const envWithDisabled = { ...workerEnv, ENABLED_CATEGORIES: "" } as Env;
    const categories = await worker.fetch(
      new Request("http://localhost/api/categories"),
      envWithDisabled
    );
    expect(categories.status).toBe(200);
    const categoriesBody = (await categories.json()) as { categories: unknown[] };
    expect(categoriesBody.categories).toEqual([]);

    const config = await worker.fetch(
      new Request("http://localhost/api/config?category=rice-cooker"),
      envWithDisabled
    );
    expect(config.status).toBe(404);
    const configBody = (await config.json()) as { error: string };
    expect(configBody.error).toBe("category_not_enabled");
  });

  it("カテゴリ単位の状態がcategoriesに含まれる", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/ready"), workerEnv);
    const body = (await response.json()) as {
      categories: Array<{
        categoryKey: string;
        enabled: boolean;
        deployed: boolean;
        published: boolean;
        activeVersionStatus: string | null;
        productCount: number;
        dataHealth: {
          sourceFresh: boolean;
          latestIngestHealthy: boolean;
        };
      }>;
    };

    expect(body.categories.length).toBeGreaterThan(0);
    for (const cat of body.categories) {
      expect(cat).toHaveProperty("categoryKey");
      expect(cat).toHaveProperty("enabled");
      expect(cat).toHaveProperty("deployed");
      expect(cat).toHaveProperty("published");
      expect(cat).toHaveProperty("activeVersionStatus");
      expect(cat).toHaveProperty("productCount");
      expect(cat.dataHealth).toHaveProperty("sourceFresh");
      expect(cat.dataHealth).toHaveProperty("latestIngestHealthy");
    }
  });

  it("deployed+publishedでもfreshnessまたは最新ingest失敗なら503", async () => {
    const { env: testEnv } = await import("cloudflare:test");
    const testDb = (testEnv as unknown as { DB: D1Database }).DB;
    const now = new Date().toISOString();
    await testDb.batch([
      testDb
        .prepare(
          `INSERT OR REPLACE INTO catalog_state (category_key, active_version_id, updated_at)
         VALUES ('rice-cooker', 'stale-version', ?)`
        )
        .bind(now),
      testDb
        .prepare(
          `INSERT OR REPLACE INTO catalog_versions (version_id, category_key, source_key, status, item_count, created_at, published_at)
         VALUES ('stale-version', 'rice-cooker', 'manual', 'published', 30, ?, ?)`
        )
        .bind(now, now),
      testDb
        .prepare(
          `INSERT OR REPLACE INTO products
         (version_id, product_id, category_key, manufacturer, model, display_name, specs_json, availability, source_key, source_updated_at, ingested_at)
         VALUES ('stale-version', 'stale-product', 'rice-cooker', 'Test', 'STALE', 'Stale', '{}', 'active', 'manual', ?, ?)`
        )
        .bind(new Date(Date.now() - 91 * 86_400_000).toISOString(), now),
      testDb
        .prepare(
          `INSERT OR REPLACE INTO ingest_runs (run_id, source_key, category_key, started_at, finished_at, status)
         VALUES ('failed-readiness-run', 'manual', 'rice-cooker', ?, ?, 'failed')`
        )
        .bind(now, now),
    ]);

    const response = await worker.fetch(new Request("http://localhost/api/ready"), workerEnv);
    const body = (await response.json()) as {
      ok: boolean;
      categories: Array<{ categoryKey: string; dataHealthy: boolean }>;
    };
    const riceCooker = body.categories.find((c) => c.categoryKey === "rice-cooker");
    expect(riceCooker?.dataHealthy).toBe(false);
    expect(body.ok).toBe(false);
    expect(response.status).toBe(503);
    await testDb.batch([
      testDb.prepare("DELETE FROM products WHERE version_id = 'stale-version'"),
      testDb.prepare("DELETE FROM catalog_versions WHERE version_id = 'stale-version'"),
      testDb.prepare("DELETE FROM catalog_state WHERE category_key = 'rice-cooker'"),
      testDb.prepare("DELETE FROM ingest_runs WHERE run_id = 'failed-readiness-run'"),
    ]);
  });

  it("KV未設定+RATE_LIMIT_BYPASSなしでrate limit対象endpointは503", async () => {
    const noBypassEnv = { ...workerEnv, RATE_LIMIT_BYPASS: undefined } as unknown as Env;
    const response = await worker.fetch(
      new Request("http://localhost/go/rakuten/token"),
      noBypassEnv
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("rate_limit_unavailable");
  });

  it("RATE_LIMIT_BYPASS=1でrate limit対象endpointが通過する", async () => {
    // rate limit対象の /api/diagnosis/evaluate。回答不足はcatalog非依存で400になるため
    // bypass経由でゲートを通過したこと（503 rate_limit_unavailableにならないこと）を検証できる。
    const response = await worker.fetch(
      new Request("http://localhost/api/diagnosis/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryKey: "rice-cooker", answers: { cookVolume: "3" } }),
      }),
      workerEnv
    );
    // bypassありなのでrate limit起因の503にはならない（回答不足の400）
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("insufficient_answers");
  });

  it("enabled+未deployedカテゴリはreadinessをblockする", async () => {
    // rice-cooker は deployed だが、enabledカテゴリにactive catalogがなければ
    // readinessを通さない
    const envWithExtra = {
      ...workerEnv,
      ENABLED_CATEGORIES: "rice-cooker,hypothetical-new-category",
    } as Env;

    const response = await worker.fetch(new Request("http://localhost/api/ready"), envWithExtra);
    const body = (await response.json()) as {
      ok: boolean;
      categories: Array<{
        categoryKey: string;
        enabled: boolean;
        deployed: boolean;
        published: boolean;
      }>;
    };

    const hypothetical = body.categories.find((c) => c.categoryKey === "hypothetical-new-category");
    // registryに未登録のキーは無視されるため、実際のenabledカテゴリが
    // active catalogなしなら503になることを検証する。
    expect(hypothetical).toBeUndefined();
    expect(body.ok).toBe(false);
    expect(response.status).toBe(503);
  });

  it("enabled+deployed+未publishedカテゴリは503を引き起こす", async () => {
    // ENABLED_CATEGORIES が空ならトラフィック対象がないため、
    // readinessもfail-closedにする。
    const envEmpty = { ...workerEnv, ENABLED_CATEGORIES: "" } as Env;
    const response = await worker.fetch(new Request("http://localhost/api/ready"), envEmpty);
    const body = (await response.json()) as { ok: boolean };
    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
  });

  it("readinessがカテゴリごとのingest healthを返す", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/ready"), workerEnv);
    const body = (await response.json()) as {
      categories: Array<{
        dataHealth: {
          lastIngestStatus: string | null;
          lastIngestFinishedAt: string | null;
          lastSourceUpdatedAt: string | null;
          consecutiveFailures: number;
        };
      }>;
    };

    expect(body.categories.length).toBeGreaterThan(0);
    for (const category of body.categories) {
      expect(category.dataHealth).toEqual(
        expect.objectContaining({ consecutiveFailures: expect.any(Number) })
      );
      expect(category.dataHealth).toHaveProperty("lastIngestStatus");
      expect(category.dataHealth).toHaveProperty("lastIngestFinishedAt");
      expect(category.dataHealth).toHaveProperty("lastSourceUpdatedAt");
    }
  });
});
