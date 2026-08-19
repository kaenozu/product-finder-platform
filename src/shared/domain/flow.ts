import type { QuestionDefinition } from "./types";

/**
 * 回答に基づいて質問の分岐（option.next）を辿り、アクティブな質問キー列を返す。
 * 未回答の質問で分岐が途切れた場合は、その時点までを返す。
 */
export function activeQuestionKeys(
  questions: QuestionDefinition[],
  answers: Record<string, string>
): string[] {
  const keys: string[] = [];
  const byOrder = [...questions].sort((a, b) => a.order - b.order);
  let current: QuestionDefinition | undefined = byOrder[0];
  while (current) {
    keys.push(current.key);
    const value = answers[current.key];
    if (value === undefined) break;
    const option = current.options.find((o) => o.value === value);
    const nextKey = option?.next ?? null;
    if (nextKey === null) break;
    current = byOrder.find((q) => q.key === nextKey);
  }
  return keys;
}
