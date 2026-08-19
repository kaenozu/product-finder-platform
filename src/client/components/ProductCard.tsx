import type { CandidateResponse } from "../lib/api";

interface Props {
  candidate: CandidateResponse;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
}

function formatPrice(value: number | null): string {
  return value == null ? "オープン価格" : `¥${value.toLocaleString("ja-JP")}〜`;
}

function specLabel(specs: Record<string, unknown>, key: string): string | null {
  const value = specs[key];
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

export function ProductCard({ candidate, rank, expanded, onToggle }: Props) {
  const { product, sources, reasons, totalScore, scoreBreakdown } = candidate;
  const top = rank === 1;

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
          <strong>{Math.round(totalScore)}</strong>
          <span>点</span>
        </div>
      </div>

      <div className="spec-chips">
        {specLabel(product.specs, "capacity") && (
          <span>{specLabel(product.specs, "capacity")}</span>
        )}
        {specLabel(product.specs, "heatingMethod") && (
          <span>{specLabel(product.specs, "heatingMethod")}</span>
        )}
        {specLabel(product.specs, "widthMm") && (
          <span>幅 {specLabel(product.specs, "widthMm")}</span>
        )}
        {specLabel(product.specs, "weightKg") && (
          <span>{specLabel(product.specs, "weightKg")}</span>
        )}
        <span className="price">{formatPrice(product.referencePriceYen)}</span>
      </div>

      <ul className="reasons">
        {reasons.map((r) => (
          <li key={r.code}>{r.text}</li>
        ))}
      </ul>

      {expanded && (
        <div className="product-card-detail">
          <h4>スコア内訳</h4>
          <ul className="score-breakdown">
            {Object.entries(scoreBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([key, value]) => (
                <li key={key}>
                  <span>{key}</span>
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
                  <li key={o.outboundUrl}>
                    <a href={o.outboundUrl} target="_blank" rel="noopener noreferrer">
                      購入先を開く ↗
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <button
        className="btn-ghost toggle"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {expanded ? "詳しく閉じる" : "詳しく見る"}
      </button>
    </article>
  );
}
