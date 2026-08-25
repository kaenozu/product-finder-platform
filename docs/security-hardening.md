# Security Hardening — 現状とロードマップ

公開 endpoint を中心としたセキュリティ強化の現状整理と、今後のロードマップをまとめる。
本ドキュメントは設計・ステータスの記録であり、コード変更を伴わない。

最終更新: 2026-08-24

## 1. 公開 Endpoint の Rate Limit

### 現状

repo 内では KV ベースの固定窓 rate limit を `src/worker/rate-limit.ts` に実装している。
endpoint ごとの窓/上限/Retry-After の一覧は **[docs/rate-limit-runbook.md の設定値テーブル](./rate-limit-runbook.md#repo-内-rate-limit-kv-ベース)**
および Cloudflare WAF 側の推奨ルール（同ドキュメント）を参照。

| Layer              | 実装場所                     | 障害時挙動                          |
| ------------------ | ---------------------------- | ----------------------------------- |
| repo 内 (KV固定窓) | `src/worker/rate-limit.ts`   | fail-open（KV障害時は通過させる）   |
| Cloudflare WAF     | Dashboard 設定（運用タスク） | edge 側で Managed Challenge / Block |

対象: `/go/:provider/:token`, `/img`, `/api/diagnosis/evaluate`。

## 2. Bot 耐性

### 現状

- **rate limit（KV固定窓）**: 上記の通り。IP 単位で 1分あたりの上限を強制。
- **click dedup（5秒窓）**: `/go` の連打による `click_events` 汚染を防ぐ。
  識別子は生 IP/UA を直接ハッシュせず、**UTC 日次でローテートする salt を組み合わせた SHA-256**
  （Issue #64）。salt は KV に TTL 48時間で保存され、生 IP/UA は保存・ログ出力されない。
  詳細は [rate-limit-runbook の Click dedup セクション](./rate-limit-runbook.md#click-dedup-の識別子日次saltローテーション) 参照。
- **outbound URL 検証**: `/go` は https + ドメイン許可リスト（`src/worker/redirect.ts`）のみ転送。
- UA パターン等のヒューリスティック判定は意図的に実装していない（誤検知コスト > 検出益）。

### 今後の選択肢

| 施策                         | 概要                                                                   | 優先度の目安                               |
| ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| **Cloudflare Turnstile**     | `/go` 直前や診断フォームに無感覚チャレンジを挿入し、bot を edge で弾く | click 汚染が実測で問題化したら導入検討     |
| WAF Managed Challenge 前置き | `/go` 高頻度 IP を challenge へ誘導（runbook の推奨設定の適用）        | Pro 以上プラン契約時に設定                 |
| click 異常検知アラート       | 日次追加行数の閾値監視（runbook 監視セクション参照）                   | 現状は手動確認。自動化は運用負荷を見て判断 |

Turnstile 導入時の注意: フロントにウィジェット組込み + Workers での siteverify 検証が必要で、
`/go` は直接リンク遷移のため Turnstile 単体では保護できない（rate limit + dedup との併用が前提）。

## 3. click_events の保持期間（Retention Cron）

### 現状

- 保持期間 **90日**（`CLICK_RETENTION_DAYS`、`src/worker/click-retention.ts`）。
- 削除は cron から [`handleScheduled`](../src/worker/scheduled.ts) が
  `cleanupExpiredClicks()` を呼び出すことで実行される
  （スケジュール: `wrangler.cron.jsonc` の `0 3 * * *` = UTC 03:00 / JST 昼前、1回最大1000行のバッチ削除）。
- 削除はバッチ処理のため active redirect をブロックしない。raw データ削除後も集約データで分析可能。

## 4. その他の現状対策（参考）

- **セキュリティヘッダー**: CSP / X-Frame-Options / nosniff 等を全レスポンスに付与
  （`src/worker/security-headers.ts`）。
- **オープンリダイレクト対策**: outbound URL は https 強制 + ホストサフィックス許可リスト。
- **カタログ欠損時の 503**: 一時障害と不存在を区別し、欠損時に空応答で誤解させない（Issue #13）。

## 5. Open Gaps（未対応・要検討）

| Gap                                                             | リスク                                               | 対応方針                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| rate limit の KV キーに生 IP を使用中（`{path}:{ip}:{bucket}`） | KV 内に IP が平文で残る（TTL 最大2分）               | Issue #64 と同様の salted hash 化を候補に。短TTLのため優先度中 |
| Turnstile 等 bot 判定が未導入                                   | 分散 bot による click 汚染を rate limit のみで受ける | 実測の汚染が発生してから §2 のロードマップで判断               |
| repo 内 rate limit の KV eventual consistency                   | 窓境界で瞬間的に上限超過し得る                       | 受容（精度より可用性）。WAF 側で厳密化                         |
| click dedup は 5秒窓のみ（長時間の連打は別手段に依存）          | 5秒以上間隔の機械的クリックは計上される              | 分析側で異常検知するか、Turnstile 導入で吸収                   |
| D1 のバックアップ/PITR 運用手順の明文化なし                     | 誤操作・障害時の復旧が属人化                         | runbook への追記を検討                                         |

## 変更履歴

| 日付       | 変更     | 理由           |
| ---------- | -------- | -------------- |
| 2026-08-24 | 初版作成 | Issue #26 対応 |
