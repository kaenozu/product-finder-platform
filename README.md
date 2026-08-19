# Product Finder Platform

「商品選択診断エンジン」の汎用基盤。**炊飯器（ブランド: めしナビ）**を第一カテゴリとして実証し、成功後に選択肢が多く・スペックだけでは選びにくく・購入単価が高いカテゴリ（洗濯機など）へ横展開します。

> 炊飯器を売るサービスを作っているのではなく、「商品選択診断エンジン」を炊飯器で実証している。

## ブランドと基盤の分離

| レイヤー             | 名前                      | 用途                                    |
| -------------------- | ------------------------- | --------------------------------------- |
| 基盤（本リポジトリ） | `product-finder-platform` | 診断エンジン・カタログ・API・計測を実装 |
| ブランド             | `めしナビ`                | 炊飯器カテゴリの消費者向けブランド      |
| 将来のブランド例     | `せんたくナビ` 等         | 同一エンジンから別カテゴリを展開        |

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
- `data/` — カタログ定義（手動キュレーション・公式検証済み）
- `tests/` — 単体・統合・e2e（Playwright）

## コマンド

```bash
pnpm install
pnpm dev            # Vite（UI開発）
pnpm verify         # format/lint/typecheck/test/integration/build/git diff --check
pnpm e2e            # Playwright e2e（ローカルサーバー自動起動）
node scripts/e2e-server.mjs   # ローカル確認用サーバー（build+migration+seed）
pnpm db:migrate     # D1ローカルmigration適用
pnpm check:deploy   # wrangler deploy --dry-run
```

## データ方針

- 手動キュレーションのみ。推測・AI補完禁止、未確認は `null`
- 品質ゲート7種を通過したバージョンのみ publish（失敗時は rejected で条件自動緩和なし）
- 価格はオープン価格のため `referencePriceYen` は原則 null（UIでは「オープン価格」表示）

## 品質管理

- `pnpm verify`（format/lint/typecheck/unit/integration/build）+ `pnpm e2e`（Playwright）を全修正で実行
- GitHub Actions（`.github/workflows/ci.yml`）で push/PR 時に同一ゲートを自動実行

## 未実施（TODO）

- 本番デプロイ（wrangler 未ログイン）
- 楽天APIキー設定 → offers 収集・`/go/` リダイレクト有効化
- カテゴリ追加（洗濯機など）の実証
- SEO / OGタグ / 診断状態のURL共有
