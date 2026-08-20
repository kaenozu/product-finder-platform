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
  /** 現在の回答から推定される最大ステップ数（分岐考慮） */
  totalSteps: number;
}

/** ある質問から始まる最長の分岐チェーン長（質問キーを起点に1カウント） */
function longestBranchLength(byOrder: QuestionDefinition[], key: string): number {
  const q = byOrder.find((x) => x.key === key);
  if (!q) return 0;
  let max = 1;
  for (const opt of q.options) {
    if (!opt.next) continue;
    max = Math.max(max, 1 + longestBranchLength(byOrder, opt.next));
  }
  return max;
}

/**
 * 質問ツリー全体の最大ステップ数（固定値）。
 * 進捗バーの分母が回答のたびに増える「1/1→2/2→3/3」現象を防ぐため、
 * どの回答でも同じ分母を使う。
 */
export function estimateTotalSteps(questions: QuestionDefinition[]): number {
  const byOrder = [...questions].sort((a, b) => a.order - b.order);
  const first = byOrder[0];
  return first ? longestBranchLength(byOrder, first.key) : 0;
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

  return {
    path,
    clean,
    currentKey,
    complete,
    answered,
    estimatedTotal: path.length,
    totalSteps: estimateTotalSteps(questions),
  };
}

export interface GraphValidationIssue {
  message: string;
}

/**
 * 質問グラフの整合性検証。
 * - 各 option.next が既存の質問キーを指している
 * - 各質問が順序の先頭から到達可能（孤児質問がない）
 * - 分岐に循環がない（無限ループ防止）
 */
export function validateQuestionGraph(questions: QuestionDefinition[]): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const keys = new Set(questions.map((q) => q.key));
  const byKey = new Map(questions.map((q) => [q.key, q]));

  // 重複キー
  if (keys.size !== questions.length) {
    issues.push({ message: "質問キーが重複している" });
  }

  // next キーの存在チェック
  for (const q of questions) {
    for (const opt of q.options) {
      if (opt.next !== undefined && opt.next !== null && !keys.has(opt.next)) {
        issues.push({ message: `${q.key}.${opt.value} の next=${opt.next} が存在しない` });
      }
    }
  }

  const byOrder = [...questions].sort((a, b) => a.order - b.order);
  const first = byOrder[0];
  if (!first) return issues;

  // 到達可能性（先頭から各 option.next を辿る）
  const reachable = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [first.key];
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    reachable.add(key);
    const q = byKey.get(key);
    for (const opt of q?.options ?? []) {
      if (opt.next) stack.push(opt.next);
    }
  }
  for (const q of questions) {
    if (!reachable.has(q.key)) {
      issues.push({ message: `${q.key} が先頭から到達できない` });
    }
  }

  // 循環検出（visited に再訪した場合は循環）
  const cycleVisited = new Set<string>();
  const onPath = new Set<string>();
  const detectCycle = (key: string): boolean => {
    if (onPath.has(key)) return true;
    if (cycleVisited.has(key)) return false;
    onPath.add(key);
    const q = byKey.get(key);
    for (const opt of q?.options ?? []) {
      if (opt.next && detectCycle(opt.next)) return true;
    }
    onPath.delete(key);
    cycleVisited.add(key);
    return false;
  };
  if (detectCycle(first.key)) {
    issues.push({ message: "質問の分岐に循環がある" });
  }

  return issues;
}
