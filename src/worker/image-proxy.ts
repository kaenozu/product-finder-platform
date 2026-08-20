import { json } from "./http";

/** 商品画像の参照元として許可するホスト（SSRF対策のホワイトリスト）。
 * 商品データに実際に存在する imageUrl のホストのみを許可する。 */
const ALLOWED_IMAGE_HOSTS = new Set([
  "www.irisohyama.co.jp",
  "www.zojirushi.co.jp",
  "panasonicjp.scene7.com",
  "kadenfan.hitachi.co.jp",
  "book.yamazen.co.jp",
  "www.tiger-corporation.com",
  "www.mitsubishielectric.co.jp",
]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * 商品画像のプロキシ。一部メーカーの画像サーバーはブラウザからの直リンクを
 * WAF でブロックする（403 / ORB）ため、Worker のサーバーサイド fetch を経由して
 * 取得する。ホワイトリスト外の URL は一切フェッチしない。
 */
export async function handleImageProxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const targetRaw = url.searchParams.get("url");
  if (!targetRaw) {
    return json({ error: "missing_url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(targetRaw);
  } catch {
    return json({ error: "invalid_url" }, { status: 400 });
  }

  if (target.protocol !== "https:") {
    return json({ error: "invalid_url" }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_HOSTS.has(target.hostname)) {
    return json({ error: "disallowed_host" }, { status: 403 });
  }

  // Cloudflare のキャッシュを利用して再取得を抑える。
  // 型定義（lib.dom の CacheStorage）とランタイム（caches.default）の差分があるため明示的に解決する。
  const cacheKey = new Request(target.toString(), { method: "GET" });
  const cache = (caches as unknown as { default: Cache }).default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(target.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    },
  });

  if (!upstream.ok) {
    return new Response(null, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return new Response(null, { status: 502 });
  }
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (length > MAX_IMAGE_BYTES) {
    return new Response(null, { status: 502 });
  }

  const body = await upstream.arrayBuffer();
  const proxied = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
  // キャッシュ投入は失敗しても応答自体は返す
  try {
    await cache.put(cacheKey, proxied.clone());
  } catch {
    // noop
  }
  return proxied;
}
