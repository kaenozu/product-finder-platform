import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BrandHome CTA semantics", () => {
  it("describes category navigation as viewing diagnosis details", () => {
    const source = readFileSync("src/client/BrandHome.tsx", "utf8");

    expect(source).toContain("の診断内容を見る →");
    expect(source).toContain("この診断の内容を見る →");
    expect(source).not.toContain("を始める →");
    expect(source).not.toContain("数問でおすすめを見る →");
  });
});
