import type { CatalogProduct, ProductOffer } from "../../shared/domain/types";

export interface FetchContext {
  categoryKey: string;
  now: Date;
}

export interface FetchedResult {
  /** 正規化前の生データ（adapter固有） */
  raw: unknown[];
  meta: {
    sourceKey: string;
    sourceUpdatedAt: string;
    fetchedCount: number;
  };
}

export interface NormalizeContext {
  categoryKey: string;
  now: Date;
}

export interface NormalizedResult {
  products: CatalogProduct[];
  offers: ProductOffer[];
  rejectedCount: number;
  rejectedReasons: string[];
}

/**
 * 商品ソースアダプタの契約（プロンプト§6 の fetch → normalize 想定）。
 * 実装はソースごとに1つ（例: manual-curated, rakuten）。
 * 広告報酬の高低は商品スコアに一切影響させない（正規化結果に報酬情報を含めない）。
 */
export interface ProductSourceAdapter {
  readonly sourceKey: string;
  fetch(ctx: FetchContext): Promise<FetchedResult>;
  normalize(raw: FetchedResult, ctx: NormalizeContext): Promise<NormalizedResult>;
}
