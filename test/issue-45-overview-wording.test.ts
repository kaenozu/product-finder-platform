import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("overview wording", () => {
  it("is present on the portal", () => {
    const portal = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(portal).toContain("診断内容を見る");
  });
});
