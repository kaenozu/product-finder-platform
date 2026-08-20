// カテゴリ非依存の診断ドメイン型（クライアント/Worker共有の純粋TypeScript）

export type CategoryKey = string;

/** 回答は質問キー→選択肢valueの文字列マップ（シリアライズ可能） */
export type AnswerRecord = Record<string, string>;

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
  /** 分岐: この選択肢を選んだとき次に表示する質問キー。null/省略で直列に進む */
  next?: string | null;
}

export interface QuestionDefinition {
  key: string;
  title: string;
  description?: string;
  options: QuestionOption[];
  /** true: 次へ進むのに回答必須（criteria導出に必要） */
  required: boolean;
  /** 表示順（0始まり） */
  order: number;
}

export type Availability = "in_stock" | "low_stock" | "out_of_stock" | "unknown";

/** 共通商品スキーマ（specs はカテゴリ固有型をジェネリクスで注入） */
export interface CatalogProduct<S extends Record<string, unknown> = Record<string, unknown>> {
  productId: string;
  categoryKey: CategoryKey;
  manufacturer: string;
  model: string;
  displayName: string;
  specs: S;
  /** カタログ上の参考価格（希望小売価格/標準価格など。実EC価格はproduct_offers） */
  referencePriceYen: number | null;
  availability: Availability;
  sourceKey: string;
  sourceUpdatedAt: string;
  ingestedAt: string;
}

export interface ProductOffer {
  productId: string;
  providerKey: string;
  providerItemId: string;
  outboundUrl: string;
  priceMinor: number | null;
  currency: string;
  availability: string | null;
  updatedAt: string;
}

export interface HardMatchResult {
  pass: boolean;
  /** 不合格理由（pass=false時は最低1件） */
  reasons: string[];
}

export interface ScoreResult {
  score: number;
  breakdown: Record<string, number>;
}

export interface RecommendationReason {
  code: string;
  text: string;
}

/** 商品カードに表示するスペック項目（カテゴリ固有の表示フォーマット） */
export interface SpecDisplayItem {
  key: string;
  label: string;
  value: string;
}

/** 品質ゲートの結果（汎用パイプラインが扱う形式） */
export interface QualityGateReport {
  name: string;
  pass: boolean;
  message: string;
}

/** UI表示用のカテゴリ固有コピー（汎用クライアントが描画に使用） */
export interface CategoryCopy {
  /** ヘッダー/トップのアプリ名 */
  appTitle: string;
  /** 開始画面のアイキャッチ */
  heroTitle: string;
  heroLead: string;
  /** 開始画面の利点リスト */
  benefits: ReadonlyArray<{ title: string; text: string }>;
  /** 開始画面の注記 */
  note: string;
  /** 結果画面のタイトル */
  resultTitle: string;
  resultNoMatchTitle: string;
}

/** カテゴリ固有モジュールの契約（プロンプト§7の想定インターフェース） */
export interface CategoryModule<C, P extends CatalogProduct> {
  key: string;
  questions: QuestionDefinition[];
  deriveCriteria(answers: AnswerRecord): C;
  canShowPartialResult(answers: AnswerRecord, criteria: C): boolean;
  /** クライアントへ公開する暫定候補開始条件。判定ロジック自体はWorker側に保持する。 */
  partialEligibility: {
    type: "answered_at_least";
    minAnswers: number;
  };
  hardMatch(product: P, criteria: C): HardMatchResult;
  score(product: P, criteria: C, offers?: ProductOffer[]): ScoreResult;
  /** おすすめ理由（positive。スコア・条件に基づく） */
  explain(product: P, criteria: C, offers?: ProductOffer[]): RecommendationReason[];
  /** 惜しい点（negative。条件から外れる点を正直に提示） */
  weakPoints?(product: P, criteria: C, offers?: ProductOffer[]): RecommendationReason[];
  /** 未回答のうち、criteria導出に影響する質問キー */
  unansweredImportantKeys(answers: AnswerRecord): string[];
  /** 回答内容とカタログ全体に基づく追加の警告（例: 指定した機能を満たす商品が存在しない） */
  buildWarnings?(answers: AnswerRecord, criteria: C, products: P[]): string[];
  /** スコア内訳キー→ユーザー向け表示ラベル */
  scoreLabels: Record<string, string>;
  /** スコアの理論上の最大値（一致度の計算に使用） */
  maxScore: number;
  /** 回答条件ごとに到達可能な最大スコア（一致度%の正規化に使用。未定義なら maxScore） */
  attainableMaxScore?(criteria: C): number;
  /** 商品カードに表示するスペック項目（カテゴリ固有の単位・文言） */
  formatSpecs(product: P): SpecDisplayItem[];
  /** カテゴリ固有の品質ゲート（範囲・構成検証など。未定義なら追加ゲートなし） */
  qualityGates?(products: P[]): QualityGateReport[];
  /** 回帰テスト用の代表回答（hard-match が非空を返すことを検証）。未定義なら回帰ゲートをスキップ */
  regressionSampleAnswers?: AnswerRecord[];
  /** UI描画用のカテゴリ固有コピー */
  copy: CategoryCopy;
}
