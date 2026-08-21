import type { CandidateResponse } from "../lib/api";
import { matchPercent, SCORE_DISCLOSURE } from "../lib/score-display";
import { AFFILIATE_REL } from "./AffiliateNote";

/** 商品画像は Worker の /img プロキシを経由して取得する
 * （一部メーカーの画像サーバーがブラウザからの直リンクをブロックするため） */
function imageProxySrc(imageUrl: string): string {
  return `/img?url=${encodeURIComponent(imageUrl)}`;
}

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

/** 購入CTAの最優先オファー: 在庫あり→最安値順。なければすべてのオファーから最安値 */
function bestOffer(candidate: CandidateResponse) {
  const offers = candidate.offers;
  if (offers.length === 0) return null;
  const inStock = offers.filter(
    (o) => o.availability === "in_stock" || o.availability === "low_stock"
  );
  const pool = inStock.length > 0 ? inStock : offers;
  const best = pool.reduce((min: (typeof pool)[number] | null, o) => {
    if (min === null) return o;
    const a = o.priceMinor ?? Number.POSITIVE_INFINITY;
    const b = min.priceMinor ?? Number.POSITIVE_INFINITY;
    return a < b ? o : min;
  }, null);
  return best;
}

function formatDate(value: string | undefined | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function ProductCard({ candidate, rank, maxScore, scoreLabels, expanded, onToggle }: Props) {
  const { product, sources, reasons, weakPoints, totalScore, scoreBreakdown, specItems } =
    candidate;
  const top = rank === 1;
  const detailId = `product-detail-${product.productId}`;
  const price = priceInfo(candidate);
  const offer = bestOffer(candidate);
  const checkedAt = formatDate(sources[0]?.checkedAt);
  const updatedAt = formatDate(product.sourceUpdatedAt);

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

      {top && <p className="score-note">{SCORE_DISCLOSURE}</p>}

      {product.imageUrl && (
        <div className="product-image">
          <img
            src={imageProxySrc(product.imageUrl)}
            alt={product.displayName}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement).hidden = true;
            }}
          />
        </div>
      )}

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

      {weakPoints.length > 0 && (
        <ul className="weak-points">
          {weakPoints.map((w) => (
            <li key={w.code}>{w.text}</li>
          ))}
        </ul>
      )}

      {offer ? (
        <a
          className="btn-cta"
          href={`/go/${encodeURIComponent(offer.providerKey)}/${encodeURIComponent(offer.providerItemId)}`}
          target="_blank"
          rel={AFFILIATE_REL}
        >
          購入する{price.value !== null ? `（${formatPrice(price)}）` : ""}
        </a>
      ) : (
        <span className="purchase-unavailable">購入先情報なし</span>
      )}

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
          <h4>データの確認日・更新日</h4>
          <ul className="sources">
            {checkedAt && <li>公式スペック確認日: {checkedAt}</li>}
            {updatedAt && <li>データ更新日: {updatedAt}</li>}
          </ul>
          <h4>出典（公式サイト・{checkedAt ?? ""}確認）</h4>
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
                      rel={AFFILIATE_REL}
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
