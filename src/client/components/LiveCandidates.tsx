import type { EvaluateResponse } from "../lib/api";
import { matchPercent, SCORE_DISCLOSURE } from "../lib/score-display";
import "./LiveCandidates.css";

interface Props {
  result: EvaluateResponse | null;
  loading: boolean;
  onOpen: () => void;
}

export function LiveCandidates({ result, loading, onOpen }: Props) {
  if (!result && !loading) return null;

  return (
    <section className="live-candidates" aria-busy={loading}>
      <div className="live-candidates-head">
        <div>
          <p className="eyebrow">回答途中の候補</p>
          <h3>いまの条件で上位候補</h3>
        </div>
        {result && !result.noMatch && (
          <button className="link" type="button" onClick={onOpen}>
            詳しく見る
          </button>
        )}
      </div>

      {loading && !result && (
        <p className="live-candidates-note" role="status">
          候補を更新しています…
        </p>
      )}

      {result?.noMatch ? (
        <p className="live-candidates-note">
          いまの条件では候補がありません。回答を戻して条件を広げると候補が増える可能性があります。
        </p>
      ) : (
        result && (
          <>
            <p className="live-candidates-note">
              暫定ランキングです。{SCORE_DISCLOSURE}回答を続けると候補と順位が自動で更新されます。
            </p>
            <ol className="live-candidate-list">
              {result.candidates.slice(0, 3).map((candidate, index) => (
                <li className="live-candidate" key={candidate.product.productId}>
                  <span className="live-rank">{index + 1}</span>
                  <span className="live-product">
                    <strong>{candidate.product.displayName}</strong>
                    <small>
                      {candidate.product.manufacturer} {candidate.product.model}
                    </small>
                    {candidate.reasons[0] && <small>{candidate.reasons[0].text}</small>}
                  </span>
                  <strong className="live-match">
                    一致度 {matchPercent(candidate.totalScore, result.maxScore)}%
                  </strong>
                </li>
              ))}
            </ol>
            {loading && (
              <p className="live-candidates-note" role="status">
                新しい回答で更新しています…
              </p>
            )}
          </>
        )
      )}
    </section>
  );
}
