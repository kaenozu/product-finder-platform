/**
 * 公開 endpoint の rate limit モジュール。
 *
 * Cloudflare Workers KV を使い、IP ベースの固定窓レート制限を実装する。
 * KV は最終的に consistency = eventual だが、rate limit は精度が低くても問題ない。
 *
 * 受入条件:
 * - 正当利用を阻害しないキー/窓/上限
 * - rate limit 超過時の HTTP 429 + Retry-After
 * - Production設定はコード変更と分離
 */
import { json } from "../http";

// ──────────────────────────────────────────────
// Rate limit 設定
// ──────────────────────────────────────────────

export interface RateLimitConfig {
  /** 窓サイズ（ミリ秒） */
  windowMs: number;
  /** 窓あたりの最大リクエスト数 */
  maxRequests: number;
  /** 超過時の Retry-After（秒） */
  retryAfterSeconds: number;
}

/**
 * endpoint ごとの rate limit 設定。
 * Production では Cloudflare Dashboard で WAF/Rate Limiting を設定するのが推奨だが、
 * repo 内でも KV ベースの保護を実装する。
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  /** /go — アフィリエイトリダイレクト。bot による click 汚染防止。 */
  "/go": {
    windowMs: 60_000, // 1分
    maxRequests: 30, // 1分間に30回まで
    retryAfterSeconds: 60,
  },
  /** /img — 画像プロキシ。cache-busting/帯域濫用防止。 */
  "/img": {
    windowMs: 60_000, // 1分
    maxRequests: 60, // 1分間に60回まで
    retryAfterSeconds: 60,
  },
  /** /api/diagnosis/evaluate — 診断API。大量リクエスト時の保護。 */
  "/api/diagnosis/evaluate": {
    windowMs: 60_000, // 1分
    maxRequests: 20, // 1分間に20回まで
    retryAfterSeconds: 60,
  },
};

// ──────────────────────────────────────────────
// KV-based rate limiter
// ──────────────────────────────────────────────

/**
 * 固定窓レート制限を KV で実装する。
 * - キー: `{path}:{ip}` （IP は CF-Connecting-IP ヘッダーから取得）
 * - 窓: 毎分ローテーション（`{path}:{ip}:{minuteBucket}`）
 * - 上限超過時: 429 + Retry-After
 */
export async function checkRateLimit(
  request: Request,
  path: string,
  kv: KVNamespace,
  config: RateLimitConfig
): Promise<{ allowed: boolean; response?: Response }> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const now = Date.now();
  const minuteBucket = Math.floor(now / config.windowMs);

  const key = `${path}:${ip}:${minuteBucket}`;

  try {
    const current = await kv.get(key, "text");
    const count = current ? Number.parseInt(current, 10) : 0;

    if (count >= config.maxRequests) {
      const retryAfter = config.retryAfterSeconds;
      return {
        allowed: false,
        response: json(
          { error: "rate_limited", retryAfter },
          {
            status: 429,
            headers: {
              "Retry-After": String(retryAfter),
              "X-RateLimit-Limit": String(config.maxRequests),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(Math.ceil(((minuteBucket + 1) * config.windowMs) / 1000)),
            },
          }
        ),
      };
    }

    // カウンタをインクリメント（最終的に consistency）
    await kv.put(key, String(count + 1), {
      expirationTtl: Math.ceil(config.windowMs / 1000) * 2, // 窓の2倍のTTL
    });

    return {
      allowed: true,
      response: undefined,
    };
  } catch {
    // KV障害時は rate limit をスキップ（正常利用を阻害しない）
    return { allowed: true };
  }
}

/**
 * endpoint パスから適用すべき rate limit 設定を取得する。
 * マッチしない場合は undefined を返す（rate limit なし）。
 */
export function getRateLimitConfig(pathname: string):
  | {
      path: string;
      config: RateLimitConfig;
    }
  | undefined {
  // 精密マッチ（/api/diagnosis/evaluate など）
  if (RATE_LIMITS[pathname]) {
    return { path: pathname, config: RATE_LIMITS[pathname] };
  }

  // プレフィックスマッチ（/go/*, /img）
  for (const [prefix, config] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix + "/") || pathname === prefix) {
      return { path: prefix, config };
    }
  }

  return undefined;
}
