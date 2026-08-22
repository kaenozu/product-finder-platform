import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("portal user intent", () => {
  it("does not represent navigation as questionnaire submission", () => {
    const portal = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(portal).not.toContain("おすすめを見る →");
  });
});
