import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("portal copy scope", () => {
  it("does not alter category start-screen copy ownership", () => {
    const portal = readFileSync("src/client/BrandHome.tsx", "utf8");
    const start = readFileSync("src/client/components/StartScreen.tsx", "utf8");
    expect(portal).not.toContain("診断をはじめる");
    expect(start).toContain("診断をはじめる");
  });
});
