import type { TopPagePreviewState } from "../lib/result-preview";

interface Props {
  state: TopPagePreviewState;
}

/**
 * トップページの「診断後にわかること」セクション。
 * 検証済みプレビューのみを実カードとして描画し、
 * 採用できるプレビューがない場合は明示的な無効状態（準備中）に倒す。
 */
export function ResultPreviewSection({ state }: Props) {
  if (state.status === "loading" || state.status === "empty") return null;

  return (
    <section className="result-preview" aria-label="診断結果の表示例">
      <div className="section-heading">
        <p className="eyebrow">診断後にわかること</p>
        <h2>候補だけでなく、選ぶ理由まで</h2>
      </div>
      {state.status === "available" ? (
        <article className="preview-card">
          <div className="preview-card-header">
            <span className="rank-badge">第一候補</span>
            <span className="preview-label">表示例</span>
          </div>
          <h3>{state.preview.candidateProduct}</h3>
          <p className="preview-summary">{state.preview.matchSummary}</p>
          <div className="preview-columns">
            <div>
              <strong>合う理由</strong>
              <ul>
                {state.preview.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>妥協点</strong>
              <p>{state.preview.weakPoint}</p>
            </div>
          </div>
          <p className="preview-difference">
            <strong>他候補との違い</strong> {state.preview.difference}
          </p>
        </article>
      ) : (
        <p className="note" role="status">
          結果の表示例は現在準備中です。カテゴリを選ぶと診断内容を確認できます。
        </p>
      )}
    </section>
  );
}
