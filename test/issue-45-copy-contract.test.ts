import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("issue #45 copy contract", () => {
  it("keeps the start action owned by StartScreen", () => {
    const source = readFileSync("src/client/components/StartScreen.tsx", "utf8");
    expect(source).toContain("診断をはじめる");
  });
});
