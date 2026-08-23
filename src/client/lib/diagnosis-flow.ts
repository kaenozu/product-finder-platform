import type { QuestionDefinition } from "../../shared/domain/types";
import type { EvaluateResponse } from "./api";
import { computeFlow } from "./flow";

/**
 * 診断フローの状態遷移（純粋リデューサ）。
 * API呼び出し（確定/暫定評価）は useDiagnosisFlow 側で行い、画面・回答・結果の
 * 整合性はここで一元管理する。App.tsxの状態集中と重複ロジック（戻る/回答変更）を解消する。
 */

export type DiagnosisScreen = "start" | "questions" | "result";

export interface DiagnosisState {
  screen: DiagnosisScreen;
  answers: Record<string, string>;
  currentKey: string | null;
  result: EvaluateResponse | null;
}

export type DiagnosisAction =
  | { type: "start"; firstKey: string }
  | { type: "restore"; answers: Record<string, string>; currentKey: string | null }
  | {
      type: "select";
      /** 選択後の分岐整理済み回答と次の質問キー（complete時は最後の質問キーを維持） */
      answers: Record<string, string>;
      currentKey: string | null;
    }
  | { type: "goto"; answers: Record<string, string>; currentKey: string | null }
  | { type: "open_result" }
  /** 確定評価の結果。結果画面へ遷移する */
  | { type: "show_result"; result: EvaluateResponse }
  /** 暫定評価の結果。質問画面に留まったまま候補のみ更新する */
  | { type: "update_preview"; result: EvaluateResponse }
  | { type: "clear_result" }
  | { type: "restart"; firstKey: string };

export function diagnosisReducer(state: DiagnosisState, action: DiagnosisAction): DiagnosisState {
  switch (action.type) {
    case "start":
      return { ...state, screen: "questions", currentKey: action.firstKey };
    case "restore":
      return {
        ...state,
        answers: action.answers,
        currentKey: action.currentKey,
        screen: "questions",
        result: null,
      };
    case "select":
    case "goto":
      return { ...state, answers: action.answers, currentKey: action.currentKey };
    case "open_result":
      return { ...state, screen: "result" };
    case "show_result":
      return { ...state, result: action.result, screen: "result" };
    case "update_preview":
      return { ...state, result: action.result };
    case "clear_result":
      return { ...state, result: null };
    case "restart":
      return { screen: "start", answers: {}, currentKey: action.firstKey, result: null };
  }
}

/**
 * 最後に回答した質問を取り除き、その質問へ戻るための状態を計算する。
 * 「戻る」と「回答を変更する」で同じ処理を使う（重複ロジックの解消）。
 * 分岐パスには未回答の現在質問も含まれるため、対象は回答済みキーのうち最後のもの。
 */
export function popLastAnswer(
  questions: QuestionDefinition[],
  answers: Record<string, string>
): { answers: Record<string, string>; currentKey: string | null } | null {
  const flow = computeFlow(questions, answers);
  const answeredOnPath = flow.path.filter((key) => answers[key] !== undefined);
  const lastKey = answeredOnPath[answeredOnPath.length - 1];
  if (!lastKey) return null;
  const removed = { ...answers };
  delete removed[lastKey];
  const next = computeFlow(questions, removed);
  return { answers: next.clean, currentKey: next.currentKey };
}
