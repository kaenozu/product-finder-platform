import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("portal entrypoint", () => {
  it("links to category overview", () => {
    const portal = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(portal).toContain("診断内容を見る");
  });
});
