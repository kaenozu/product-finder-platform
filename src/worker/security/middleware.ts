/**
 * security/middleware.ts — 統合セキュリティチェック。
 *
 * リクエストに対して以下のチェックを順に実行し、
 * いずれかでブロックされたら即座にエラー応答を返す。
 *
 * 1. Rate limit (KV-based)
 * 2. Bot detection (UA pattern)
 * 3. Redirect guard (fetchWithRedirectGuard) は個別 handler 内
 */
import type { Env } from "../env";
import { json } from "../http";
import { checkRateLimit, getRateLimitConfig } from "./rate-limiter";

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

/**
 * 全セキュリティチェックを実行する。
 * @returns Response = ブロックされた（呼び出し側はそのまま返す）、null = 通過
 */
export async function runSecurityChecks(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  const rateLimit = getRateLimitConfig(pathname);
  if (!rateLimit) return null;

  // A missing KV binding disables the production rate-limit contract. Keep the
  // existing fail-closed behavior in this shared middleware; only loopback
  // requests with an explicit development bypass may proceed.
  if (!env.KV) {
    const url = new URL(request.url);
    const localBypass = env.RATE_LIMIT_BYPASS === "1" && isLoopbackHost(url.hostname);
    if (!localBypass) {
      return json({ error: "rate_limit_unavailable", path: rateLimit.path }, { status: 503 });
    }
    return null;
  }

  const result = await checkRateLimit(request, rateLimit.path, env.KV, rateLimit.config);
  return !result.allowed && result.response ? result.response : null;
}
