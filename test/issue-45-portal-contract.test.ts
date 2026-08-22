import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("portal category navigation", () => {
  it("keeps overview links as navigation rather than actions", () => {
    const source = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(source).toContain("の診断内容を見る →");
    expect(source).toContain("この診断の内容を見る →");
  });
});
