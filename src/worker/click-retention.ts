/**
 * click_events の retention/集約/削除ポリシー。
 *
 * - click_events は無制限に増加しないよう retention を設ける
 * - ユーザー単位の重複クリックをデュープ（同一 user fingerprint + 短時間 window）
 * - 集約: 日次集計テーブルへ集約し、raw データは保持期限後に削除
 *
 * 受入条件:
 * - click分析用途のイベントと機械的アクセスを分離
 * - retention処理がactive redirectや既存分析を壊さない
 * - click_events の無制限増加を防ぐ
 * - 異なるユーザーの正当クリックをデュープしない
 */
import type { Env } from "./env";

// ──────────────────────────────────────────────
// User fingerprint (privacy-preserving)
// ──────────────────────────────────────────────

/**
 * ユーザーフィンガープリントを生成する。
 * IP + User-Agent を SHA-256 でハッシュし、
 * 個人を特定できないよう設計しつつ同一ユーザーの重複検出は可能にする。
 */
async function userFingerprint(request: Request): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "unknown";
  const data = new TextEncoder().encode(`${ip}:${ua}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16); // 16 chars = 64bit十分
}

// ──────────────────────────────────────────────
// Retention policy
// ──────────────────────────────────────────────

/**
 * click_events の保持期間（日）。
 * 90日: 月次・四半期の分析に十分。それ以降は集約済みデータから分析。
 */
export const CLICK_RETENTION_DAYS = 90;

/**
 * デュープ防止の時間窓（ミリ秒）。
 * 同一 token への連続クリックを 5 秒以内なら重複とみなす。
 */
export const CLICK_DEDUP_WINDOW_MS = 5_000;

// ──────────────────────────────────────────────
// Dedup check
// ──────────────────────────────────────────────

/**
 * 直近の同一ユーザー同一tokenへのクリックがデュープ防止窓内にあるか判定する。
 * KV を使って直近のクリック時刻を保存する。
 *
 * @returns true = デュープ（記録しない）、false = 新規（記録する）
 */
export async function isDuplicateClick(
  env: Env,
  providerKey: string,
  providerItemId: string,
  request: Request
): Promise<boolean> {
  const fingerprint = await userFingerprint(request);
  const key = `click_dedup:${fingerprint}:${providerKey}:${providerItemId}`;

  try {
    const lastClick = await env.KV?.get(key, "text");
    if (!lastClick) return false;

    const lastClickTime = Number.parseInt(lastClick, 10);
    const now = Date.now();

    if (now - lastClickTime < CLICK_DEDUP_WINDOW_MS) {
      return true; // デュープ
    }

    return false;
  } catch {
    // KV障害時はデュープチェックをスキップ
    return false;
  }
}

/**
 * クリック時刻を KV に記録する。
 */
export async function recordClickTimestamp(
  env: Env,
  providerKey: string,
  providerItemId: string,
  request: Request
): Promise<void> {
  const fingerprint = await userFingerprint(request);
  const key = `click_dedup:${fingerprint}:${providerKey}:${providerItemId}`;
  const now = Date.now();

  try {
    await env.KV?.put(key, String(now), {
      expirationTtl: Math.ceil(CLICK_DEDUP_WINDOW_MS / 1000) * 2,
    });
  } catch {
    // KV障害時は記録失敗してもリダイレクトは続行
  }
}

// ──────────────────────────────────────────────
// Retention cleanup
// ──────────────────────────────────────────────

/**
 * 保持期間を超過した click_events を削除する。
 * Cron job (scheduled handler) から呼ばれる。
 *
 * - 削除はバッチで行い、active redirect をブロックしない
 * - 1回の削除で最大 1000 行まで
 * - 削除結果を返す（監査用）
 */
export async function cleanupExpiredClicks(
  env: Env
): Promise<{ deleted: number; errors: number; hasMore: boolean }> {
  const cutoffDate = new Date(Date.now() - CLICK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoffDate.toISOString();

  let deleted = 0;
  const BATCH_SIZE = 100;
  const MAX_BATCHES_PER_RUN = 10;

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    try {
      // 古いイベントをバッチで取得。1回のcronで最大1000行に制限する。
      const result = await env.DB.prepare(
        `SELECT id FROM click_events WHERE clicked_at < ? LIMIT ?`
      )
        .bind(cutoffIso, BATCH_SIZE)
        .all<{ id: string }>();

      if (!result.results || result.results.length === 0) {
        return { deleted, errors: 0, hasMore: false };
      }

      const ids = result.results.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      await env.DB.prepare(`DELETE FROM click_events WHERE id IN (${placeholders})`)
        .bind(...ids)
        .run();

      deleted += ids.length;
      if (ids.length < BATCH_SIZE) {
        return { deleted, errors: 0, hasMore: false };
      }
    } catch {
      return { deleted, errors: 1, hasMore: true };
    }
  }

  return { deleted, errors: 0, hasMore: true };
}
