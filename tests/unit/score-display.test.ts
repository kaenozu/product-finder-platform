import { describe, expect, it } from "vitest";
import { matchPercent, SCORE_DISCLOSURE } from "../../src/client/lib/score-display";

describe("score display", () => {
  it.each([
    [0, 11, 0],
    [5.5, 11, 50],
    [11, 11, 100],
    [4, 0, 0],
    [4, -1, 0],
  ])("normalizes %s/%s to %s%%", (score, maxScore, expected) => {
    expect(matchPercent(score, maxScore)).toBe(expected);
  });

  it("uses a non-probabilistic disclosure shared by provisional and final views", () => {
    expect(SCORE_DISCLOSURE).toContain("相対的な目安");
    expect(SCORE_DISCLOSURE).toContain("確率や正解率ではありません");
  });
});
