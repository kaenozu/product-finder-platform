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

  it("DEV_SEEDが誤設定されても公開ホストでは403にする", async () => {
    const response = await worker.fetch(
      new Request("https://preview.example.com/api/dev/seed", { method: "POST" }),
      { ...workerEnv, DEV_SEED: "1" }
    );

    expect(response.status).toBe(403);
  });
});
