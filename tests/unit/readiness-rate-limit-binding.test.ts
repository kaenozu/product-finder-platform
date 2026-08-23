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
});
