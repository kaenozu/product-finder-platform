/** アフィリエイト共通開示（サイト全体で共通の文言）。ID設定は別途。 */
export const AFFILIATE_DISCLOSURE =
  "本サイトはアフィリエイト広告を利用しています。購入リンク経由でのご購入で、サイト運営の収益につながる場合があります。";

/** 購入リンク共通のrel属性（アフィリエイトリンクの検索エンジン向け明示） */
export const AFFILIATE_REL = "sponsored nofollow noopener";

export function AffiliateNote() {
  return <p className="affiliate-note">{AFFILIATE_DISCLOSURE}</p>;
}
