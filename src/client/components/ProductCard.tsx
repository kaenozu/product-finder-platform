import type { CandidateResponse } from "../lib/api";

interface Props {
  candidate: CandidateResponse;
  rank: number;
  maxScore: number;
  scoreLabels: Record<string, string>;
  expanded: boolean;
  onToggle: () => void;
}

function formatPrice(value: number | null): string {
  return value == null ? "オープン価格" : `¥${value.toLocaleString("ja-JP")}〜`;
}

/** 表示価格: 実売オファー最安値を優先し、なければカタログ参考価格 */
function effectivePriceYen(candidate: CandidateResponse): number | null {
  const prices = candidate.offers
    .map((o) => o.priceMinor)
    .filter((p): p is number => p !== null && p > 0);
  if (prices.length > 0) return Math.min(...prices) / 100;
  return candidate.product.referencePriceYen;
}

function matchPercent(totalScore: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.round((totalScore / maxScore) * 100);
}

function level(totalScore: number, maxScore: number): string {
  const ratio = totalScore / maxScore;
  if (ratio >= 0.8) return "高い";
  if (ratio >= 0.6) return "ふつう";
  return "低め";
}

export function ProductCard({ candidate, rank, maxScore, scoreLabels, expanded, onToggle }: Props) {
  const { product, sources, reasons, totalScore, scoreBreakdown, specItems } = candidate;
  const top = rank === 1;
  const detailId = `product-detail-${product.productId}`;

  return (
    <article className={`product-card ${expanded ? "expanded" : ""} ${top ? "top" : ""}`}>
      <div className="product-card-head">
        <div className="rank-badge">{top ? "ベスト" : `${rank}位`}</div>
        <div className="product-card-main">
          <h3>{product.displayName}</h3>
          <p className="model">
            {product.manufacturer} {product.model}
          </p>
        </div>
        <div className="score">
          <strong>一致度 {matchPercent(totalScore, maxScore)}%</strong>
          <span>おすすめ度 {level(totalScore, maxScore)}</span>
        </div>
      </div>

      <div className="spec-chips">
        {specItems.map((item) => (
          <span key={item.key} title={item.label}>
            {item.value}
          </span>
        ))}
        <span className="price" title="実売最安値">
          {formatPrice(effectivePriceYen(candidate))}
        </span>
      </div>

      <ul className="reasons">
        {reasons.map((r) => (
          <li key={r.code}>{r.text}</li>
        ))}
      </ul>

      <button
        className="btn-ghost toggle"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailId}
      >
        {expanded ? "詳しく閉じる" : "詳しく見る"}
      </button>

      {expanded && (
        <div className="product-card-detail" id={detailId}>
          <h4>
            スコア内訳（合計 {Math.round(totalScore * 10) / 10} / {maxScore}）
          </h4>
          <ul className="score-breakdown">
            {Object.entries(scoreBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([key, value]) => (
                <li key={key}>
                  <span>{scoreLabels[key] ?? key}</span>
                  <strong>{Math.round(value * 100) / 100}</strong>
                </li>
              ))}
          </ul>
          <h4>
            出典（公式サイト・{new Date(sources[0]?.checkedAt ?? "").getFullYear() || ""}年確認）
          </h4>
          <ul className="sources">
            {sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  スペック・出典を開く ↗
                </a>
              </li>
            ))}
          </ul>
          {candidate.offers.length > 0 && (
            <>
              <h4>購入先</h4>
              <ul className="sources">
                {candidate.offers.map((o) => (
                  <li key={o.providerItemId}>
                    <a
                      href={`/go/${encodeURIComponent(o.providerKey)}/${encodeURIComponent(
                        o.providerItemId
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      購入先を開く ↗
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </article>
  );
}
