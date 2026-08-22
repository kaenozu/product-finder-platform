import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BrandHome navigation scope", () => {
  it("does not add an auto-start URL contract", () => {
    const portal = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(portal).not.toContain("?start=");
  });
});
