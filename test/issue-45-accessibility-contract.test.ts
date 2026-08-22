import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("portal CTA accessibility", () => {
  it("keeps navigational CTAs as anchors", () => {
    const source = readFileSync("src/client/BrandHome.tsx", "utf8");
    expect(source).toContain('className="btn-primary hero-cta" href=');
    expect(source).toContain('className="category-card"');
  });
});
