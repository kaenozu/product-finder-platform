import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("issue #45 scope", () => {
  it("changes copy without adding an auto-start query contract", () => {
    const source = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(source).not.toContain("?start=");
  });
});
