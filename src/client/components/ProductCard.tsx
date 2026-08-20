import type { CandidateResponse } from "../lib/api";

interface Props {
  candidate: CandidateResponse;
  rank: number;
  maxScore: number;
  scoreLabels: Record<string, string>;
  expanded: boolean;
  onToggle: () => void;
}

type PriceInfo =
  | { kind: "sale"; label: "実売価格"; value: number }
  | { kind: "reference"; label: "参考価格"; value: number }
  | { kind: "unknown"; label: "価格情報なし"; value: null };

function priceInfo(candidate: CandidateResponse): PriceInfo {
  const prices = candidate.offers
    .map((o) => o.priceMinor)
    .filter((p): p is number => p !== null && p > 0);
  if (prices.length > 0) {
    return { kind: "sale", label: "実売価格", value: Math.min(...prices) / 100 };
  }
  if (candidate.product.referencePriceYen !== null) {
    return {
      kind: "reference",
      label: "参考価格",
      value: candidate.product.referencePriceYen,
    };
  }
  return { kind: "unknown", label: "価格情報なし", value: null };
}

function formatPrice(info: PriceInfo): string {
  return info.value === null
    ? info.label
    : `${info.label} ¥${info.value.toLocaleString("ja-JP")}〜`;
}

function matchPercent(totalScore: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.round((totalScore / maxScore) * 100);
}

export function ProductCard({ candidate, rank, maxScore, scoreLabels, expanded, onToggle }: Props) {
  const { product, sources, reasons, totalScore, scoreBreakdown, specItems } = candidate;
  const top = rank === 1;
  const detailId = `product-detail-${product.productId}`;
  const price = priceInfo(candidate);
  const primaryOffer = candidate.offers[0];

  return (
    <article className={`product-card ${expanded ? "expanded" : ""} ${top ? "top" : ""}`}>
      <div className="product-card-head">
        <div className="rank-badge">{top ? "あなたなら、まずこれ" : `${rank}位`}</div>
        <div className="product-card-main">
          <h3>{product.displayName}</h3>
          <p className="model">
            {product.manufacturer} {product.model}
          </p>
        </div>
        <div className="score">
          <strong>条件一致度 {matchPercent(totalScore, maxScore)}%</strong>
        </div>
      </div>

      {top && <p className="score-note">回答条件をスコア化した目安です。</p>}

      <div className="spec-chips">
        {specItems.map((item) => (
          <span key={item.key} title={item.label}>
            {item.value}
          </span>
        ))}
        <span className="price" title={price.label}>
          {formatPrice(price)}
        </span>
      </div>

      <ul className="reasons">
        {reasons.slice(0, top ? 3 : 2).map((r) => (
          <li key={r.code}>{r.text}</li>
        ))}
      </ul>

      <div className="purchase-cta" aria-label="購入先">
        {primaryOffer ? (
          <a
            className="btn-primary"
            href={`/go/${encodeURIComponent(primaryOffer.providerKey)}/${encodeURIComponent(primaryOffer.providerItemId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {primaryOffer.providerKey}で購入先を確認
            {primaryOffer.priceMinor !== null
              ? `（¥${(primaryOffer.priceMinor / 100).toLocaleString("ja-JP")}〜）`
              : ""}{" "}
            ↗
          </a>
        ) : (
          <span className="purchase-unavailable">購入先情報なし</span>
        )}
      </div>

      <button
        className="btn-ghost toggle"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailId}
      >
        {expanded ? "詳しく閉じる" : "詳しく見る（出典・内訳）"}
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
                      href={`/go/${encodeURIComponent(o.providerKey)}/${encodeURIComponent(o.providerItemId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {o.providerKey}の購入先を開く ↗
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
