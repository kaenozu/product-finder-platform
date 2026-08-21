/**
 * click_events の retention/集約/削除ポリシー。
 *
 * - click_events は無制限に増加しないよう retention を設ける
 * - bot による重複クリックをデュープ（同一 token + 短時間 window）
 * - 集約: 日次集計テーブルへ集約し、raw データは保持期限後に削除
 *
 * 受入条件:
 * - click分析用途のイベントと機械的アクセスを分離
 * - retention処理がactive redirectや既存分析を壊さない
 * - click_events の無制限増加を防ぐ
 */
import type { Env } from "./env";

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
 * 直近の同一 token へのクリックがデュープ防止窓内にあるか判定する。
 * KV を使って直近のクリック時刻を保存する。
 *
 * @returns true = デュープ（記録しない）、false = 新規（記録する）
 */
export async function isDuplicateClick(
  env: Env,
  providerKey: string,
  providerItemId: string
): Promise<boolean> {
  const key = `click_dedup:${providerKey}:${providerItemId}`;

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
  providerItemId: string
): Promise<void> {
  const key = `click_dedup:${providerKey}:${providerItemId}`;
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
export async function cleanupExpiredClicks(env: Env): Promise<{ deleted: number; errors: number }> {
  const cutoffDate = new Date(Date.now() - CLICK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoffDate.toISOString();

  let deleted = 0;
  let errors = 0;
  const BATCH_SIZE = 100;

  try {
    // 古いイベントをバッチで取得
    const result = await env.DB.prepare(`SELECT id FROM click_events WHERE clicked_at < ? LIMIT ?`)
      .bind(cutoffIso, BATCH_SIZE)
      .all<{ id: string }>();

    if (!result.results || result.results.length === 0) {
      return { deleted: 0, errors: 0 };
    }

    // バッチ削除
    const ids = result.results.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");

    await env.DB.prepare(`DELETE FROM click_events WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run();

    deleted = ids.length;
  } catch {
    errors = 1;
  }

  return { deleted, errors };
}

// ──────────────────────────────────────────────
// Click event filtering (bot vs human)
// ──────────────────────────────────────────────

/**
 * click event が bot 由来かどうかの判定ヒント。
 * IP・UA を保存しないプライバシー設計のため、
 * 以下のシグナルで間接的に判定する：
 *
 * - デュープ窓内の連続クリック
 * - 非 standard User-Agent（_headless, bot, crawler）
 *
 * ただし IP/UA を保存しないため、判定結果はログ出力のみで
 * click_events テーブルには影響させない。
 */
export function isLikelyBot(request: Request): boolean {
  const ua = request.headers.get("user-agent") ?? "";

  // headless ブラウザや bot の User-Agent パターン
  const botPatterns = [
    /headless/i,
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /curl/i,
    /wget/i,
    /python-requests/i,
    /go-http-client/i,
  ];

  return botPatterns.some((p) => p.test(ua));
}
