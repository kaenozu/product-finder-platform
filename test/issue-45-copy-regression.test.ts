import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("issue #45 regression", () => {
  it("does not reintroduce start wording on portal category links", () => {
    const source = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(source).not.toContain("数問でおすすめを見る →");
    expect(source).not.toContain("を始める →");
  });
});
