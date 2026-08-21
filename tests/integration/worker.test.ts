import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../worker/index";
import type { Env } from "../../src/worker/env";

const workerEnv = env as unknown as Env;

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
  });

  it("公開カタログ未投入時はreadyを503で返し、診断の空結果と区別する", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/ready"), workerEnv);

    expect(response.status).toBe(503);
    expect((await response.json()) as unknown).toMatchObject({
      ok: false,
      service: "product-finder-platform",
    });
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

  it("category未指定のconfigは後方互換でdefaultカテゴリを返す", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/config"), workerEnv);

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({ categoryKey: "rice-cooker" });
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

  it("カテゴリ単位の状態がcategoriesに含まれる", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/ready"), workerEnv);
    const body = (await response.json()) as {
      categories: Array<{
        categoryKey: string;
        enabled: boolean;
        published: boolean;
        activeVersionStatus: string | null;
        productCount: number;
      }>;
    };

    expect(body.categories.length).toBeGreaterThan(0);
    for (const cat of body.categories) {
      expect(cat).toHaveProperty("categoryKey");
      expect(cat).toHaveProperty("enabled");
      expect(cat).toHaveProperty("published");
      expect(cat).toHaveProperty("activeVersionStatus");
      expect(cat).toHaveProperty("productCount");
    }
  });
});
