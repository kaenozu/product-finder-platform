# Rate Limit & Bot Protection Runbook

## 概要

公開 endpoint の濫用耐性を、repo 内実装と Cloudflare edge 側設定の役割を明確にして管理する。

## Threat Model

| Endpoint                  | Threat                             | Impact                           | 対策                             |
| ------------------------- | ---------------------------------- | -------------------------------- | -------------------------------- |
| `/go/:provider/:token`    | bot による click 連打              | click_events 汚染、D1 write 増加 | rate limit + dedup               |
| `/img`                    | cache-busting query による帯域濫用 | Cloudflare 帯域コスト増加        | rate limit + query normalization |
| `/api/diagnosis/evaluate` | 大量リクエスト                     | D1 read 増加、CPU 時間消費       | rate limit                       |

## Repo 内 Rate Limit (KV ベース)

### 設定値

| Path                      | Window | Max Requests | Retry-After |
| ------------------------- | ------ | ------------ | ----------- |
| `/go`                     | 60s    | 30           | 60s         |
| `/img`                    | 60s    | 60           | 60s         |
| `/api/diagnosis/evaluate` | 60s    | 20           | 60s         |

### KV Namespace

Rate limit 用の KV namespace を wrangler に追加する:

```jsonc
// wrangler.worker.jsonc
{
  "kv_namespaces": [{ "binding": "KV", "id": "..." }],
}
```

### 適用手順

1. Cloudflare Dashboard で KV namespace を作成
2. wrangler に binding を追加
3. `wrangler deploy` でデプロイ
4. 正常リクエストが通ることを確認
5. 閾値超過時に 429 が返ることを確認

## Cloudflare WAF/Rate Limiting (Edge 側)

### 推奨設定

Cloudflare Dashboard > Security > WAF > Rate limiting rules:

#### `/go` endpoint

```
Rule: (http.request.uri.path eq "/go")
Rate: 30 requests / 60 seconds
Counting expression: ip.addr
Action: Managed Challenge (60s)
Burst: 10
```

#### `/img` endpoint

```
Rule: (http.request.uri.path eq "/img")
Rate: 60 requests / 60 seconds
Counting expression: ip.addr
Action: Managed Challenge (60s)
Burst: 20
```

#### `/api/diagnosis/evaluate`

```
Rule: (http.request.uri.path eq "/api/diagnosis/evaluate")
Rate: 20 requests / 60 seconds
Counting expression: ip.addr
Action: Block (429)
Burst: 5
```

### 適用前の確認

1. **Cloudflare Pro 以上** が必要（Free プランでは Rate Limiting が使えない場合がある）
2. 正常ユーザーが rate limit に引っかからないことを確認
3. Bot の検出ロジックが過剰でないことを確認

## Click Events Retention

### 保持期間

- **90日**: 月次・四半期の分析に十分
- 90日以降は `cleanupExpiredClicks()` で自動削除

### 削除手順

Cron job (scheduled handler) から `cleanupExpiredClicks()` を呼び出す:

```typescript
// src/worker/scheduled.ts
import { cleanupExpiredClicks } from "./click-retention";

export async function handleScheduled(env: Env): Promise<void> {
  await cleanupExpiredClicks(env);
}
```

### 削除の安全性

- 削除はバッチで行い（1回100行）、active redirect をブロックしない
- 既存の分析クエリは集約済みデータを使用するため、raw データ削除の影響なし

## Rate Limit 超過時の HTTP 応答

```json
{
  "error": "rate_limited",
  "retryAfter": 60
}
```

**レスポンスヘッダー:**

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1692633600
```

## Bot Detection

### パターン

User-Agent ヘッダーで以下のパターンを検出:

- `HeadlessChrome`, `HeadlessFirefox`
- `bot`, `crawler`, `spider`, `scraper`
- `curl`, `wget`, `python-requests`, `go-http-client`

### 注意事項

- IP/UA を保存しないため、判定結果はログ出力のみ
- click_events テーブルには影響させない（プライバシー最小化）

## 監視

### アラート条件

- rate limit 超過が 1分間に 100 回以上
- click_events の日次追加行数が 10,000 行以上
- D1 read/write の異常増加

### 確認コマンド

```bash
# rate limit ログ確認
wrangler tail --env production | grep "rate_limited"

# click_events 行数確認
wrangler d1 execute product-finder-platform --command "SELECT COUNT(*) FROM click_events"

# 古い click_events の削除確認
wrangler d1 execute product-finder-platform --command "SELECT COUNT(*) FROM click_events WHERE clicked_at < datetime('now', '-90 days')"
```

## 変更履歴

| 日付       | 変更     | 理由           |
| ---------- | -------- | -------------- |
| 2026-08-21 | 初版作成 | Issue #26 対応 |
