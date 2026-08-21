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

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECT_HOPS = 5;
export const UPSTREAM_TIMEOUT_MS = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * URL が画像プロキシの安全条件を満たすか検証する。
 * - https: プロトコルであること
 * - ALLOWED_IMAGE_HOSTS のホスト名であること
 */
export function isAllowedTarget(targetUrl: URL): boolean {
  return targetUrl.protocol === "https:" && ALLOWED_IMAGE_HOSTS.has(targetUrl.hostname);
}

/**
 * redirect chain を手動で追跡し、各 Location を検証する。
 * - redirect を自動追従せず、各ステップで安全検証を行う
 * - redirect hop 数に上限を設け、loop/過剰 redirect を拒否する
 * - 各 Location が https: かつ許可ホストであることを必須化する
 */
export async function fetchWithRedirectGuard(
  target: URL,
  init: RequestInit
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = target;
  let hops = 0;

  // biome-ignore lint/complexity/noInferrableTypes: explicit for clarity
  let response: Response;
  while (hops <= MAX_REDIRECT_HOPS) {
    response = await fetch(currentUrl.toString(), {
      ...init,
      redirect: "manual", // 自動追従を無効化
    });

    // redirect 以外のステータスコードならそのまま返す
    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { response, finalUrl: currentUrl };
    }

    let nextUrl: URL;
    try {
      // 相対URLの解決を考慮
      nextUrl = new URL(location, currentUrl);
    } catch {
      return { response, finalUrl: currentUrl };
    }

    // redirect先の安全検証
    if (!isAllowedTarget(nextUrl)) {
      return {
        response: new Response(null, { status: 502 }),
        finalUrl: currentUrl,
      };
    }

    currentUrl = nextUrl;
    hops++;
  }

  // redirect回数上限到達
  return {
    response: new Response(null, { status: 502 }),
    finalUrl: currentUrl,
  };
}

/**
 * streaming response から最大 maxSize バイトまで読み取り、上限超過時に中断する。
 * Content-Length ヘッダーの有無に依存しない。
 */
export async function readWithSizeLimit(
  response: Response,
  maxSize: number
): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxSize) {
        reader.cancel().catch(() => {});
        return null; // 上限超過 → null で失敗を示す
      }
      chunks.push(value);
    }
  } catch {
    reader.cancel().catch(() => {});
    return null;
  }

  // 全チャンクを結合
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * 商品画像のプロキシ。一部メーカーの画像サーバーはブラウザからの直リンクを
 * WAF でブロックする（403 / ORB）ため、Worker のサーバーサイド fetch を経由して
 * 取得する。ホワイトリスト外の URL は一切フェッチしない。
 *
 * セキュリティ境界:
 * - redirect を自動追従せず、各 Location を明示的に再検証
 * - redirect hop 数に上限を設け、loop/過剰 redirect を拒否
 * - Content-Length の有無に依存せず、streaming で 5MB 上限を強制
 * - upstream fetch に明示 timeout を設定
 * - cache 投入は全検証通過後の応答のみ
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

  // redirect 自動追従を無効化した fetch を使用
  const { response: upstream } = await fetchWithRedirectGuard(target, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!upstream.ok) {
    return new Response(null, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    upstream.body?.cancel().catch(() => {});
    return new Response(null, { status: 502 });
  }

  // Content-Length の有無に依存せず、streaming で 5MB 上限を強制
  const bodyBytes = await readWithSizeLimit(upstream, MAX_IMAGE_BYTES);
  if (!bodyBytes) {
    return new Response(null, { status: 502 });
  }

  const proxied = new Response(bodyBytes as unknown as BodyInit, {
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
