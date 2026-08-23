# Product Finder Platform

「商品選択診断エンジン」の汎用基盤。**炊飯器（消費者向けブランド: pitariko）**を第一カテゴリとして実証し、将来は同じ基盤で別カテゴリへ横展開します。

> 炊飯器を売るサービスを作っているのではなく、「商品選択診断エンジン」を炊飯器で実証している。

## ブランドと基盤の分離

| レイヤー             | 名前                      | 用途                                    |
| -------------------- | ------------------------- | --------------------------------------- |
| 基盤（本リポジトリ） | `product-finder-platform` | 診断エンジン・カタログ・API・計測を実装 |
| ブランド             | `pitariko`                | 炊飯器カテゴリの消費者向けブランド      |
| 将来のブランド例     | カテゴリごとに別途定義    | 同一エンジンから別カテゴリを展開        |

## アーキテクチャ

```
category module（質問・判定ロジック）
  └─ registry（カテゴリ登録・解決）
       └─ adapter 契約 → shared/domain でバリデーション
            └─ D1（catalog_state / catalog_versions / products / product_offers / click_events / ingest_runs）
                 └─ Worker API（config / evaluate / products/:id / go/ redirect / dev:seed）
                      └─ React UI（質問フロー → 結果）
```

カテゴリ追加は「新モジュール＋カタログデータ」のみ。判定・品質ゲート・UIは汎用です。

## ディレクトリ構成

- `src/shared/domain/` — カテゴリモジュールと判定エンジン（UI/Worker共通）
- `src/worker/` — Cloudflare Worker の API・cron・リダイレクト・devシード
- `src/client/` — React UI（モバイル/デスクトップ対応・日本語）
- `migrations/` — D1スキーマ
- `src/worker/data/` — カタログ定義（手動キュレーション・公式検証済み）
- `tests/` — 単体・統合・e2e（Playwright）

## コマンド

```bash
node --version       # Node.js 24推奨（.node-version）
pnpm install
pnpm dev            # Vite（UI開発）
pnpm verify         # format/lint/typecheck/test/integration/build/git diff --check
pnpm verify:ci      # verify + audit + deploy dry-run + Playwright E2E
pnpm e2e            # Playwright e2e（ローカルサーバー自動起動）
node scripts/e2e-server.mjs   # ローカル確認用サーバー（build+migration+seed）
pnpm db:migrate     # D1ローカルmigration適用
pnpm db:rollback -- --category <key> --version <id>  # catalog rollback（dry-runが既定）
pnpm check:deploy   # wrangler deploy --dry-run
```

## データ方針

- 手動キュレーションのみ。推測・AI補完禁止、未確認は `null`
- 品質ゲート（schema / count / uniqueness / product-type / カテゴリ固有 range・fixture / hard-condition回帰 / version回帰 / freshness）を通過したバージョンのみ publish（失敗時は rejected で条件自動緩和なし）
- 価格はオープン価格のため `referencePriceYen` は原則 null（UIでは「オープン価格」表示）

## Production構成と既知の制約

- 公開アプリ: https://pitariko.pages.dev/
- Pages側のUIと、診断API・カタログを提供するCloudflare Workerを分離する。
- 本番カタログはD1の`catalog_state` / `catalog_versions` / `products` / `product_offers`で管理する。
- 開発用seedは本番データ投入の代替ではない。Production D1のmigration・catalog publish・rollbackは明示的な運用手順で行う。
  - rollbackは `pnpm db:rollback -- --category <key> --version <version_id> [--execute]`（dry-runが既定）
- 現在の炊飯器adapterは手動キュレーション中心で、offers/価格の自動取得が実データ更新パイプラインとして成立しているとは限らない。価格や在庫は推測しない。

### 障害時の応答契約

- 診断API・商品詳細・`/go` は、公開カタログの欠損/未publishを `503 catalog_unavailable` として通常のno-match/404と区別して返す（fail-closed）。
- 未知カテゴリを既定カテゴリへfallbackさせない。`/api/config` はcategory指定必須（未指定400、未知404 `unsupported_category`）。

## URL共有

- 診断の回答状態は `/rice-cooker?a=cookVolume:5.5,heating:ih...` 形式でURLに同期される（replaceState）。
- 結果画面の「結果のURLをコピー」で共有できる。リロード・共有リンクから回答と結果が復元される。
- 不正な改変クエリは質問定義に対して検証され、無効ペアは黙って破棄される。

## Cron スケジュール

- **実行時刻**: UTC 03:00 = JST 12:00 (noon)
- **設定ファイル**: `wrangler.cron.jsonc` の `"0 3 * * *"`（cron triggerの単一の所有者。`wrangler.worker.jsonc` には意図的に持たせない）
- **Cloudflare Cron Triggers は UTC 基準**: DST の影響を受けない日本時間前提
- **時刻変更**: Production trigger 変更としてコード変更と分離して扱う
- **read-back 確認**: deploy 後に `wrangler triggers list` で trigger 設定を確認する

## 運用上の設定依存（要Dashboard管理）

- `KV`: rate limit / click dedup 用のKV namespace binding。**未設定だと該当APIは503でfail-closedする**ため、Pages/Worker両環境でのbinding設定を必須とする。
- `ENABLED_CATEGORIES`: 公開有効カテゴリのカンマ区切り。未設定なら全登録カテゴリを有効とする。
- `DEV_SEED` / `RATE_LIMIT_BYPASS`: ローカル開発専用。本番には設定しない。

## 品質管理

- `pnpm verify:ci`（format/lint/typecheck/unit/integration/build/audit/deploy dry-run/E2E）を全修正で実行
- GitHub Actions（`.github/workflows/ci.yml`）で push/PR 時に同一ゲートを自動実行

## 未実施・保留（TODO）

- offers/価格の実データ更新adapter（規約・rate limit・freshness policyを含む）
- カテゴリ追加（炊飯器以外）の実証
- SSG化（商品詳細ページ・schema.org構造データ）とOG画像 — SPAのSEO制約を抜本的に解消する次段
