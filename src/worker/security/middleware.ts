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
import { checkRateLimit, getRateLimitConfig } from "./rate-limiter";

/**
 * 全セキュリティチェックを実行する。
 * @returns Response = ブロックされた（呼び出し側はそのまま返す）、null = 通過
 */
export async function runSecurityChecks(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  // 1. Rate limit check
  const rl = getRateLimitConfig(pathname);
  if (rl && env.KV) {
    const result = await checkRateLimit(request, rl.path, env.KV, rl.config);
    if (!result.allowed && result.response) {
      return result.response;
    }
  }

  return null;
}
