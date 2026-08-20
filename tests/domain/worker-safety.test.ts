import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "../../src/shared/domain/types";
import { evaluationRequestSchema } from "../../src/worker/api";
import { json } from "../../src/worker/http";
import { freshnessGate } from "../../src/worker/ingest/quality-gates";

function product(productId: string, sourceUpdatedAt: string): CatalogProduct {
  return {
    productId,
    categoryKey: "test",
    manufacturer: "TEST",
    model: productId,
    displayName: productId,
    specs: {},
    referencePriceYen: null,
    availability: "in_stock",
    sourceKey: "test",
    sourceUpdatedAt,
    ingestedAt: "2026-08-20T00:00:00.000Z",
  };
}

describe("worker response safety", () => {
  it("JSON応答にCORSとnosniffヘッダーを付与する", () => {
    const response = json({ ok: true });

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("診断入力のキー長・値長・回答数を制限する", () => {
    expect(
      evaluationRequestSchema.safeParse({
        categoryKey: "rice-cooker",
        answers: { cookVolume: "5.5" },
      }).success
    ).toBe(true);
    expect(
      evaluationRequestSchema.safeParse({
        categoryKey: "x".repeat(65),
        answers: {},
      }).success
    ).toBe(false);
    expect(
      evaluationRequestSchema.safeParse({
        categoryKey: "rice-cooker",
        answers: Object.fromEntries(
          Array.from({ length: 101 }, (_, index) => [`q${index}`, "answer"])
        ),
      }).success
    ).toBe(false);
  });
});

describe("freshness gate", () => {
  it("1件だけ新しくても古い商品が混在していれば拒否する", () => {
    const result = freshnessGate(
      [product("fresh", "2026-08-19"), product("stale", "2026-01-01")],
      new Date("2026-08-20T00:00:00.000Z")
    );

    expect(result.pass).toBe(false);
    expect(result.message).toContain("2026-01-01");
  });

  it("不正な更新日時を拒否する", () => {
    const result = freshnessGate(
      [product("invalid", "not-a-date")],
      new Date("2026-08-20T00:00:00.000Z")
    );

    expect(result).toMatchObject({ pass: false, message: "不正な更新日時の商品がある" });
  });

  it("未来の更新日時を拒否する", () => {
    const result = freshnessGate(
      [product("future", "2026-08-23")],
      new Date("2026-08-20T00:00:00.000Z")
    );

    expect(result).toMatchObject({ pass: false, message: "未来の更新日時の商品がある" });
  });
});
