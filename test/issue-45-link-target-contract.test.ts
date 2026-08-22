import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("category link targets", () => {
  it("continues to link to the category overview route", () => {
    const source = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(source).toContain('href={`/${onlyCategory.categoryKey}`}');
    expect(source).toContain('href={`/${category.categoryKey}`}');
  });
});
