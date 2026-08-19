import type { QuestionDefinition } from "../../shared/domain/types";
import { activeQuestionKeys } from "../../shared/domain/flow";

export interface FlowState {
  /** 回答済み+最初の未回答までのキー列 */
  path: string[];
  /** パス上で回答済みのキーのみ（分岐変更による古い回答は除外） */
  clean: Record<string, string>;
  /** 現在の質問キー（null=完了） */
  currentKey: string | null;
  complete: boolean;
  answered: number;
  estimatedTotal: number;
}

export function computeFlow(
  questions: QuestionDefinition[],
  answers: Record<string, string>
): FlowState {
  const path = activeQuestionKeys(questions, answers);
  const clean: Record<string, string> = {};
  let currentKey: string | null = null;
  let complete = false;
  let answered = 0;

  for (const key of path) {
    const value = answers[key];
    if (value !== undefined) {
      clean[key] = value;
      answered += 1;
      const q = questions.find((x) => x.key === key);
      const option = q?.options.find((o) => o.value === value);
      if (option && !option.next) complete = true;
    } else {
      currentKey = key;
      break;
    }
  }

  return { path, clean, currentKey, complete, answered, estimatedTotal: path.length };
}
