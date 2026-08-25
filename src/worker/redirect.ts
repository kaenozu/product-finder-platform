import type { Env } from "./env";
import { isDuplicateClick, recordClickTimestamp } from "./click-retention";
import { json } from "./http";
import { getEnabledCategories } from "./api";
import { hasPublishedCatalog } from "./repo/catalog";

/**
 * /go/:provider/:token — アフィリエイト遷移のリダイレクト。
 * 有効なhttpsかつ許可リスト済みドメインの outbound_url のみ転送
 * （オープンリダイレクト対策）。
 * 計測はクリック回数に必要な最小限（商品・バージョンのみ）に留め、IP・UA・refererは保存しない。
 */

// outbound_url の遷移先ホスト許可リスト（サフィックス一致）。
// 新規provider/offers adapterを追加する際はここを更新する。
const ALLOWED_OUTBOUND_DOMAIN_SUFFIXES: readonly string[] = [
  // 楽天アフィリエイト経由
  "rakuten.co.jp",
  // 現行カタログで使用しているメーカー公式ドメイン
  "panasonic.jp",
  "zojirushi.co.jp",
  "irisohyama.co.jp",
  "mitsubishielectric.co.jp",
  "tiger-corporation.com",
  "yamazen.co.jp",
  "hitachi-gls.co.jp",
];

export function isAllowedOutboundHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_OUTBOUND_DOMAIN_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}
export async function handleRedirect(
  env: Env,
  request: Request,
  providerKey: string,
  token: string
): Promise<Response> {
  if (!/^[a-z0-9-]+$/i.test(providerKey) || !/^[a-z0-9._~-]{1,200}$/i.test(token)) {
    return json({ error: "invalid_redirect" }, { status: 400 });
  }

  const offers = await env.DB.prepare(
    `SELECT o.version_id, o.product_id, p.category_key, o.provider_item_id, o.outbound_url, o.updated_at, o.availability
       FROM product_offers o
       JOIN catalog_state s ON s.active_version_id = o.version_id
       JOIN products p ON p.version_id = o.version_id AND p.product_id = o.product_id
       WHERE o.provider_key = ? AND o.provider_item_id = ?
       LIMIT 2`
  )
    .bind(providerKey, token)
    .all<{
      version_id: string;
      product_id: string;
      category_key: string;
      provider_item_id: string;
      outbound_url: string;
      updated_at: string;
      availability: string | null;
    }>();

  const [offer] = offers.results ?? [];
  if (!offer || offers.results?.length !== 1) {
    // カタログ欠損（一時障害）とoffer不存在を区別する（Issue #13）。
    // published な active catalog が1つも無い場合は404ではなく503で応答する。
    const enabledKeys = [...getEnabledCategories(env)];
    if (!(await hasPublishedCatalog(env.DB, enabledKeys))) {
      return json({ error: "catalog_unavailable" }, { status: 503 });
    }
    return json({ error: "redirect_not_found" }, { status: 404 });
  }

  if (!getEnabledCategories(env).has(offer.category_key)) {
    return json({ error: "category_not_enabled" }, { status: 404 });
  }

  // 鮮度チェック: 7日以上前のofferはリダイレクトしない
  const offerAge = Date.now() - new Date(offer.updated_at ?? "1970-01-01").getTime();
  const OFFER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  if (offerAge > OFFER_MAX_AGE_MS) {
    return json({ error: "offer_stale" }, { status: 410 });
  }

  // availability チェック: out_of_stock はリダイレクトしない
  if (offer.availability === "out_of_stock") {
    return json({ error: "offer_unavailable" }, { status: 410 });
  }

  let outboundUrl: URL;
  try {
    outboundUrl = new URL(offer.outbound_url);
  } catch {
    return json({ error: "redirect_not_found" }, { status: 404 });
  }
  if (outboundUrl.protocol !== "https:" || !outboundUrl.hostname) {
    return json({ error: "redirect_not_found" }, { status: 404 });
  }
  if (!isAllowedOutboundHost(outboundUrl.hostname)) {
    return json({ error: "redirect_not_found" }, { status: 404 });
  }

  // Bot detection and dedup check (per-user fingerprint)
  const isDup = await isDuplicateClick(env, providerKey, offer.provider_item_id, request);

  // デュープでない場合のみクリックを記録
  if (!isDup) {
    try {
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO click_events
          (id, provider_key, provider_item_id, product_id, category_key, version_id, clicked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          providerKey,
          offer.provider_item_id,
          offer.product_id,
          offer.category_key,
          offer.version_id,
          new Date().toISOString()
        )
        .run();

      // クリック時刻を記録（デュープ防止用）
      await recordClickTimestamp(env, providerKey, offer.provider_item_id, request);
    } catch {
      // 計測失敗でもリダイレクトは続行する（ユーザー体験を妨げない）
    }
  }

  return Response.redirect(outboundUrl.href, 302);
}
