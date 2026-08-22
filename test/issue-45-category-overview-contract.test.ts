import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("category overview semantics", () => {
  it("uses overview wording on both portal entry points", () => {
    const source = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(source.match(/診断内容を見る/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
