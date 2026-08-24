import { describe, expect, it } from "vitest";

import { handleRequest } from "../../src/worker/handler";
import type { Env } from "../../src/worker/env";

function envWithoutKv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ...overrides,
  };
}

describe("service readiness rate-limit binding", () => {
  it("fails closed on a public host when KV is missing", async () => {
    const response = await handleRequest(
      new Request("https://pitariko.example/api/ready"),
      envWithoutKv()
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(503);
    await expect(response!.json()).resolves.toEqual({
      ok: false,
      service: "product-finder-platform",
      error: "rate_limit_unavailable",
      checks: { rateLimitKv: false },
    });
  });

  it("does not let RATE_LIMIT_BYPASS mask a missing production binding", async () => {
    const response = await handleRequest(
      new Request("https://pitariko.example/api/ready"),
      envWithoutKv({ RATE_LIMIT_BYPASS: "1" })
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(503);
  });

  it.each([
    ["/go/provider/token", "GET"],
    ["/img", "GET"],
    ["/api/diagnosis/evaluate", "POST"],
  ] as const)(
    "fails closed on public hosts for %s when RATE_LIMIT_BYPASS=%s",
    async (pathname, method) => {
      for (const bypass of [undefined, "0", "01", "1"] as const) {
        const request = new Request(`https://pitariko.example${pathname}`, {
          method,
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        const response = await handleRequest(
          request,
          envWithoutKv(bypass === undefined ? {} : { RATE_LIMIT_BYPASS: bypass })
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(503);
        await expect(response!.json()).resolves.toMatchObject({
          error: "rate_limit_unavailable",
        });
      }
    }
  );

  it("preserves loopback local bypass for RATE_LIMIT_BYPASS=1", async () => {
    const response = await handleRequest(
      new Request("http://localhost/api/diagnosis/evaluate", {
        method: "POST",
        body: "{}",
      }),
      envWithoutKv({ RATE_LIMIT_BYPASS: "1" })
    );

    expect(response).not.toBeNull();
    expect(response!.status).not.toBe(503);
  });
});
