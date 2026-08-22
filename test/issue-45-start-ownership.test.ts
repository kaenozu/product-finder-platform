import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("questionnaire start ownership", () => {
  it("leaves the actual start CTA in StartScreen", () => {
    const start = readFileSync("src/client/components/StartScreen.tsx", "utf8");
    expect(start).toContain("診断をはじめる");
  });
});
