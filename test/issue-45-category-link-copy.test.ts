import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("category link copy", () => {
  it("uses overview wording", () => {
    const source = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(source).toContain("診断内容を見る");
  });
});
