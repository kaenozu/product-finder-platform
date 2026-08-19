import type { Env } from "./env";
import { json } from "./http";

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`kuraberu:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * /go/:provider/:token — アフィリエイト遷移の計測付きリダイレクト。
 * 有効なhttpsの outbound_url のみ転送（オープンリダイレクト対策）。
 */
export async function handleRedirect(
  env: Env,
  request: Request,
  providerKey: string,
  token: string
): Promise<Response> {
  if (!/^[a-z0-9-]+$/i.test(providerKey) || !/^[a-z0-9-]+$/i.test(token)) {
    return json({ error: "invalid_redirect" }, { status: 400 });
  }

  const offer = await env.DB.prepare(
    `SELECT o.version_id, o.product_id, o.category_key, o.provider_item_id, o.outbound_url
       FROM product_offers o
       JOIN catalog_state s ON s.active_version_id = o.version_id
       WHERE o.provider_key = ? AND o.provider_item_id = ?
       LIMIT 1`
  )
    .bind(providerKey, token)
    .first<{
      version_id: string;
      product_id: string;
      category_key: string;
      provider_item_id: string;
      outbound_url: string;
    }>();

  if (!offer || !offer.outbound_url.startsWith("https://")) {
    return json({ error: "redirect_not_found" }, { status: 404 });
  }

  try {
    const cf = request.headers.get("cf-connecting-ip") ?? "unknown";
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO click_events
        (id, provider_key, provider_item_id, product_id, category_key, version_id, clicked_at, referer, user_agent, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        providerKey,
        offer.provider_item_id,
        offer.product_id,
        offer.category_key,
        offer.version_id,
        new Date().toISOString(),
        request.headers.get("referer"),
        request.headers.get("user-agent"),
        await hashIp(cf)
      )
      .run();
  } catch {
    // 計測失敗でもリダイレクトは続行する（ユーザー体験を妨げない）
  }

  return Response.redirect(offer.outbound_url, 302);
}
