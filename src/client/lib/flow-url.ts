import type { QuestionDefinition } from "../../shared/domain/types";

/**
 * 診断状態のURL共有（README TODO「診断状態のURL共有」対応）。
 * 回答を ?a=key:value,key:value 形式でURLに載せ、リロード・シェアで復元できるようにする。
 */

/** 回答レコードをコンパクトなクエリ値へエンコードする */
export function encodeAnswersToQuery(answers: Record<string, string>): string {
  return Object.entries(answers)
    .map(([key, value]) => `${encodeURIComponent(key)}:${encodeURIComponent(value)}`)
    .join(",");
}

/**
 * URLクエリ値を回答レコードへデコードする。
 * 質問定義に対してキー・値を検証し、不正なペアは黙って破棄する（改変URLへの安全側対応）。
 */
export function decodeAnswersFromQuery(
  query: string | null | undefined,
  questions: QuestionDefinition[]
): Record<string, string> {
  const answers: Record<string, string> = {};
  if (!query) return answers;
  const byKey = new Map(questions.map((q) => [q.key, q]));
  for (const pair of query.split(",")) {
    if (!pair) continue;
    const sep = pair.indexOf(":");
    if (sep <= 0) continue;
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(pair.slice(0, sep));
      value = decodeURIComponent(pair.slice(sep + 1));
    } catch {
      continue;
    }
    const question = byKey.get(key);
    if (!question || !question.options.some((o) => o.value === value)) continue;
    answers[key] = value;
  }
  return answers;
}

/** 現在の回答を反映したURLへ置換する（履歴を汚さないreplaceState） */
export function syncAnswersToUrl(answers: Record<string, string>): void {
  const url = new URL(window.location.href);
  const encoded = encodeAnswersToQuery(answers);
  if (encoded) {
    url.searchParams.set("a", encoded);
  } else {
    url.searchParams.delete("a");
  }
  window.history.replaceState(null, "", url.href);
}
