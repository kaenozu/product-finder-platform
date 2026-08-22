import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("portal start wording", () => {
  it("does not claim the portal link starts the questionnaire", () => {
    const source = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(source).not.toContain("おすすめを見る →");
    expect(source).not.toContain("を始める →");
  });
});
