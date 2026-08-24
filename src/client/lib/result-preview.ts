import type { CategorySummary } from "./api";

/** 検証済みの結果プレビューデータ（描画に必要な全フィールドが揃っている状態） */
export interface ResultPreviewData {
  candidateProduct: string;
  matchSummary: string;
  reasons: ReadonlyArray<string>;
  weakPoint: string;
  difference: string;
}

/** トップページ結果プレビューの表示状態（カテゴリ依存の分岐を集約した判定結果） */
export type TopPagePreviewState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "available"; categoryKey: string; preview: ResultPreviewData }
  | { status: "unavailable" };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * API応答のresultPreviewが描画可能か検証する。
 * カテゴリコピーの一部欠損（reasons欠落・空配列・非文字列など）を、
 * 描画時の例外ではなく「プレビュー無し」として扱うためのフォールバック判定。
 */
export function isRenderablePreview(value: unknown): value is ResultPreviewData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNonEmptyString(v.candidateProduct) &&
    isNonEmptyString(v.matchSummary) &&
    isNonEmptyString(v.weakPoint) &&
    isNonEmptyString(v.difference) &&
    Array.isArray(v.reasons) &&
    v.reasons.length > 0 &&
    v.reasons.every(isNonEmptyString)
  );
}

/**
 * カテゴリ一覧からトップページの結果プレビュー状態を決定する。
 * - 「描画可能な」resultPreviewを持つ最初のカテゴリを採用する
 * - 不完全なresultPreviewは欠落とみなし、後続カテゴリへフォールバックする
 * - どのカテゴリも採用できない場合はunavailable（明示的な無効状態）を返す
 */
export function resolveTopPagePreview(
  categories: readonly CategorySummary[] | null
): TopPagePreviewState {
  if (categories === null) return { status: "loading" };
  if (categories.length === 0) return { status: "empty" };
  for (const category of categories) {
    const candidate: unknown = category?.copy?.resultPreview;
    if (!isRenderablePreview(candidate)) continue;
    return { status: "available", categoryKey: category.categoryKey, preview: candidate };
  }
  return { status: "unavailable" };
}
