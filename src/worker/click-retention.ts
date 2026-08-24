/**
 * click_events の retention/集約/削除ポリシー。
 *
 * - click_events は無制限に増加しないよう retention を設ける
 * - ユーザー単位の重複クリックをデュープ（同一 user identifier + 短時間 window）
 * - 集約: 日次集計テーブルへ集約し、raw データは保持期限後に削除
 *
 * 受入条件:
 * - click分析用途のイベントと機械的アクセスを分離
 * - retention処理がactive redirectや既存分析を壊さない
 * - click_events の無制限増加を防ぐ
 * - 異なるユーザーの正当クリックをデュープしない
 * - 生のIP/UAは保存・ログ出力せず、日次salt込みのSHA-256識別子のみをKVに使う（Issue #64）
 */
import type { Env } from "./env";

// ──────────────────────────────────────────────
// User identifier (privacy-preserving, salted)
// ──────────────────────────────────────────────

/** 日次ローテーティング salt の KV キープレフィックス。 */
export const CLICK_DEDUP_SALT_KEY_PREFIX = "click_dedup_salt";

/**
 * 日次saltの KV 保持期間（秒）= 48時間。
 * saltキー自体にUTC日付を埋め込むため、実ローテーション境界は UTC 0時。
 * TTLは旧saltの掃除用で、日跨ぎ直後のリクエストが前日saltを読めてくる
 * （KV書き込みから48時間）余裕を持たせている。
 */
export const CLICK_DEDUP_SALT_TTL_SECONDS = 48 * 60 * 60;

function utcDateStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function dailySaltKey(now: Date): string {
  return `${CLICK_DEDUP_SALT_KEY_PREFIX}:${utcDateStamp(now)}`;
}

/**
 * 指定時刻のUTC日に対応する日次saltを取得する。存在しなければ
 * crypto.randomUUID() で生成して KV に保存する（TTL 48時間）。
 *
 * - salt値そのものに個人情報は含まれない
 * - KV障害時はエフェメラルなsaltへフォールバックする。
 *   この場合同一isolate外ではデュープ検出が効かなくなるが、
 *   誤って正当クリックを落とすことはない（fail-open）
 */
export async function getDailySalt(env: Pick<Env, "KV">, now: Date = new Date()): Promise<string> {
  const kv = env.KV;
  const key = dailySaltKey(now);
  try {
    const existing = await kv?.get(key, "text");
    if (existing) return existing;
    const salt = crypto.randomUUID();
    await kv?.put(key, salt, { expirationTtl: CLICK_DEDUP_SALT_TTL_SECONDS });
    return salt;
  } catch {
    // KV障害時はデュープ精度より可用性を優先（fail-open）
    return crypto.randomUUID();
  }
}

async function toSha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * デュープ判定用識別子を生成する（Issue #64）。
 *
 *   identifier = SHA-256("{dailySalt}:{IP}:{User-Agent}")
 *
 * - 同一日内なら同一ユーザーは常に同じ識別子になる → 5秒窓のデュープ検出が機能する
 * - UTC日付が変わるとsaltが変わる → 異なる日の識別子が衝突することはない
 * - 生のIP/UAはKVにもログにも出ず、salt込みハッシュのみが使われる
 */
export async function computeDedupIdentifier(
  env: Pick<Env, "KV">,
  request: Request,
  now: Date = new Date()
): Promise<string> {
  const salt = await getDailySalt(env, now);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "unknown";
  return toSha256Hex(`${salt}:${ip}:${ua}`);
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
 * KV を使って直近のクリック時刻を保存する。KVキーにはsalt込みの
 * 識別子（computeDedupIdentifier）のみを使用する。
 *
 * @param now デュープ判定時刻（省略時は現在時刻。テストで日跨ぎを挙入するために注入可能）
 * @returns true = デュープ（記録しない）、false = 新規（記録する）
 */
export async function isDuplicateClick(
  env: Env,
  providerKey: string,
  providerItemId: string,
  request: Request,
  now: Date = new Date()
): Promise<boolean> {
  const identifier = await computeDedupIdentifier(env, request, now);
  const key = `click_dedup:${identifier}:${providerKey}:${providerItemId}`;

  try {
    const lastClick = await env.KV?.get(key, "text");
    if (!lastClick) return false;

    const lastClickTime = Number.parseInt(lastClick, 10);

    if (now.getTime() - lastClickTime < CLICK_DEDUP_WINDOW_MS) {
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
 *
 * @param now 記録時刻（省略時は現在時刻。テストで日跨ぎを挙入するために注入可能）
 */
export async function recordClickTimestamp(
  env: Env,
  providerKey: string,
  providerItemId: string,
  request: Request,
  now: Date = new Date()
): Promise<void> {
  const identifier = await computeDedupIdentifier(env, request, now);
  const key = `click_dedup:${identifier}:${providerKey}:${providerItemId}`;
  const timestamp = now.getTime();

  try {
    await env.KV?.put(key, String(timestamp), {
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
