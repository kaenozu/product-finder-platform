import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("portal navigation URL", () => {
  it("does not add an implicit auto-start query parameter", () => {
    const source = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(source).not.toContain("?start=");
  });
});
