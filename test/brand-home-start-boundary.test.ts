import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("start boundary", () => {
  it("keeps the actual start action on the category screen", () => {
    const start = readFileSync("src/client/components/StartScreen.tsx", "utf8");
    expect(start).toContain("診断をはじめる");
  });
});
