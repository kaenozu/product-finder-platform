import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BrandHome CTA semantics", () => {
  it("uses overview wording instead of a second start action", () => {
    const portal = readFileSync("src/client/BrandHome.tsx", "utf8");
    const start = readFileSync("src/client/components/StartScreen.tsx", "utf8");

    expect(portal).toContain("の診断内容を見る →");
    expect(portal).toContain("この診断の内容を見る →");
    expect(portal).not.toContain("を始める →");
    expect(portal).not.toContain("数問でおすすめを見る →");
    expect(start).toContain("診断をはじめる");
  });
});
