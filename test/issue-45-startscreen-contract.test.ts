import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("category StartScreen contract", () => {
  it("retains StartScreen after config load", () => {
    const source = readFileSync("src/client/App.tsx", "utf8");
    expect(source).toContain('setScreen("start")');
  });
});
