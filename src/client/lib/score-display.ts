export const SCORE_DISCLOSURE =
  "回答条件を独自に点数化した相対的な目安です。確率や正解率ではありません。";

export function matchPercent(totalScore: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.round((totalScore / maxScore) * 100);
}
