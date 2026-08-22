import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("category navigation contract", () => {
  it("keeps direct category routes on StartScreen", () => {
    const source = readFileSync("src/client/App.tsx", "utf8");
    expect(source).toContain('setScreen("start")');
    expect(source).toContain('<StartScreen copy={config.copy} onStart={handleStart} />');
  });
});
