import { describe, expect, it } from "vitest";
import type { EvaluateResponse } from "../../src/client/lib/api";
import {
  diagnosisReducer,
  popLastAnswer,
  type DiagnosisState,
} from "../../src/client/lib/diagnosis-flow";

const RESULT: EvaluateResponse = {
  status: "final",
  progress: { answered: 2, estimatedTotal: 2 },
  criteria: {},
  noMatch: false,
  noMatchReasons: [],
  matchedCount: 1,
  warnings: [],
  maxScore: 10,
  scoreLabels: {},
  candidates: [],
};

function initialState(overrides: Partial<DiagnosisState> = {}): DiagnosisState {
  return { screen: "start", answers: {}, currentKey: null, result: null, ...overrides };
}

describe("diagnosisReducer", () => {
  it("startで質問画面へ遷移する", () => {
    const next = diagnosisReducer(initialState(), { type: "start", firstKey: "volume" });
    expect(next.screen).toBe("questions");
    expect(next.currentKey).toBe("volume");
  });

  it("show_resultで結果を保持し結果画面へ遷移する", () => {
    const next = diagnosisReducer(initialState({ screen: "questions", currentKey: "heat" }), {
      type: "show_result",
      result: RESULT,
    });
    expect(next.screen).toBe("result");
    expect(next.result).toBe(RESULT);
  });

  it("restartで全状態が初期化される", () => {
    const next = diagnosisReducer(
      initialState({
        screen: "result",
        answers: { volume: "large" },
        currentKey: "heat",
        result: RESULT,
      }),
      { type: "restart", firstKey: "volume" }
    );
    expect(next).toEqual({
      screen: "start",
      answers: {},
      currentKey: "volume",
      result: null,
    });
  });

  it("restoreで質問画面から再開する（結果は破棄）", () => {
    const next = diagnosisReducer(initialState({ screen: "result", result: RESULT }), {
      type: "restore",
      answers: { volume: "large" },
      currentKey: "heat",
    });
    expect(next.screen).toBe("questions");
    expect(next.answers).toEqual({ volume: "large" });
    expect(next.result).toBeNull();
  });
});

describe("popLastAnswer（戻る/回答変更の共通処理）", () => {
  it("最後の回答を取り除き、その質問へ戻る", () => {
    // 直線グラフ: heat → null のため、heatを消すとcurrentKey=heatに戻る
    const popped = popLastAnswer(
      [
        {
          key: "volume",
          title: "量は?",
          required: true,
          order: 0,
          options: [{ value: "small", label: "S", next: "heat" }],
        },
        {
          key: "heat",
          title: "加熱は?",
          required: true,
          order: 1,
          options: [{ value: "ih", label: "IH", next: null }],
        },
      ],
      { volume: "small", heat: "ih" }
    );
    expect(popped).toEqual({ answers: { volume: "small" }, currentKey: "heat" });
  });

  it("回答がなければ何もしない", () => {
    expect(popLastAnswer([], {})).toBeNull();
  });
});
