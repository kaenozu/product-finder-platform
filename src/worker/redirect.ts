import type { Env } from "./env";
import { isDuplicateClick, recordClickTimestamp } from "./click-retention";
import { json } from "./http";

/**
 * /go/:provider/:token — アフィリエイト遷移のリダイレクト。
 * 有効なhttpsの outbound_url のみ転送（オープンリダイレクト対策）。
 * 計測はクリック回数に必要な最小限（商品・バージョンのみ）に留め、IP・UA・refererは保存しない。
 */
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
    `SELECT o.version_id, o.product_id, p.category_key, o.provider_item_id, o.outbound_url
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
    }>();

  const [offer] = offers.results ?? [];
  if (!offer || offers.results?.length !== 1) {
    return json({ error: "redirect_not_found" }, { status: 404 });
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

  // Bot detection and dedup check
  const isDup = await isDuplicateClick(env, providerKey, offer.provider_item_id);

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
      await recordClickTimestamp(env, providerKey, offer.provider_item_id);
    } catch {
      // 計測失敗でもリダイレクトは続行する（ユーザー体験を妨げない）
    }
  }

  void request;
  return Response.redirect(outboundUrl.href, 302);
}
