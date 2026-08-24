import { describe, expect, it } from "vitest";
import { canonicalUrl } from "../../src/client/seo";

describe("canonicalUrl", () => {
  it("normalizes the SPA pathname without query or hash", () => {
    expect(canonicalUrl("/rice-cooker/", "https://pitariko.pages.dev")).toBe(
      "https://pitariko.pages.dev/rice-cooker"
    );
    expect(canonicalUrl("/", "https://pitariko.pages.dev")).toBe("https://pitariko.pages.dev/");
  });
});
