import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("issue #45 final CTA contract", () => {
  it("keeps portal and category start semantics distinct", () => {
    const portal = readFileSync("src/client/BrandHome.tsx", "utf8");
    const start = readFileSync("src/client/components/StartScreen.tsx", "utf8");
    expect(portal).toContain("診断内容を見る");
    expect(start).toContain("診断をはじめる");
  });
});
