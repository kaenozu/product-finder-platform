import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("direct category route", () => {
  it("does not auto-start the questionnaire", () => {
    const source = readFileSync("src/client/App.tsx", "utf8");
    const afterConfigLoad = source.slice(source.indexOf("fetchConfig(categoryKey)"), source.indexOf("function invalidatePreview"));
    expect(afterConfigLoad).toContain('setScreen("start")');
    expect(afterConfigLoad).not.toContain('setScreen("questions")');
  });
});
