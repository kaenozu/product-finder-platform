import { useEffect, useState } from "react";
import { fetchCategories } from "./lib/api";
import type { CategorySummary } from "./lib/api";
import { resolveTopPagePreview } from "./lib/result-preview";
import { AffiliateNote } from "./components/AffiliateNote";
import { ResultPreviewSection } from "./components/ResultPreviewSection";

function BrandLogo() {
  return (
    <span className="logo">
      <img className="logo-mark" src="/favicon.svg" alt="" width="20" height="20" />
      pitariko
    </span>
  );
}

export function BrandHome() {
  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories()
      .then((res) => setCategories(res.categories))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "カテゴリ一覧の読み込みに失敗しました")
      );
  }, []);

  const maxQuestions = categories?.length
    ? Math.max(...categories.map((category) => category.questionCount))
    : null;
  const previewState = resolveTopPagePreview(categories);
  const onlyCategory = categories?.length === 1 ? categories[0] : undefined;

  return (
    <main>
      <header className="app-header">
        <BrandLogo />
        <span className="header-note">無料・登録不要</span>
      </header>

      <section className="brand-hero" aria-labelledby="brand-title">
        <p className="eyebrow">家電・商品選びの診断サービス</p>
        <h1 id="brand-title">
          pitariko<span className="brand-tag">— 条件に合う理由まで見える、商品選び。</span>
        </h1>
        <p className="lead">
          予算・使い方・欲しい機能から、あなたに合う商品候補を数問で絞り込みます。
          候補だけでなく、合う理由と惜しい点まで確認できます。
        </p>
        <div className="hero-facts" aria-label="サービスの利用条件">
          {maxQuestions !== null && <span>最大{maxQuestions}問</span>}
          <span>無料・登録不要</span>
          <span>公式仕様を照合</span>
        </div>
        {onlyCategory && (
          <a className="btn-primary hero-cta" href={`/${onlyCategory.categoryKey}`}>
            {onlyCategory.copy.appTitle}の診断内容を見る →
          </a>
        )}
        {categories && categories.length > 1 && (
          <a className="btn-primary hero-cta" href="#category-heading">
            カテゴリを選んで診断する →
          </a>
        )}
      </section>

      <ResultPreviewSection state={previewState} />

      <section className="category-list" aria-labelledby="category-heading">
        <div className="section-heading">
          <p className="eyebrow">公開中のカテゴリ</p>
          <h2 id="category-heading">診断を選ぶ</h2>
        </div>
        {error && (
          <p className="note error" role="alert">
            {error}
          </p>
        )}
        {!categories && !error && (
          <p className="note" role="status">
            読み込み中…
          </p>
        )}
        {categories?.length === 0 && <p className="note">現在診断できるカテゴリはありません。</p>}
        <div className="category-grid">
          {categories?.map((category) => (
            <a
              key={category.categoryKey}
              className="category-card"
              href={`/${category.categoryKey}`}
            >
              <p className="eyebrow">{category.copy.appTitle}</p>
              <h3>{category.copy.heroTitle}</h3>
              <p>{category.copy.heroLead}</p>
              <span className="category-facts">
                最大{category.questionCount}問 · 無料・登録不要
              </span>
              <span className="category-cta">この診断の内容を見る →</span>
            </a>
          ))}
        </div>
      </section>

      <section className="trust-section" aria-label="判定の根拠">
        <div className="section-heading">
          <p className="eyebrow">納得して選ぶために</p>
          <h2>判定の根拠</h2>
        </div>
        <div className="trust-grid">
          <article>
            <strong>回答条件 × 商品仕様</strong>
            <p>回答内容と、カテゴリごとの公式仕様を照合して候補を絞ります。</p>
          </article>
          <article>
            <strong>理由と惜しい点を表示</strong>
            <p>一致した条件だけでなく、合わない条件も確認できます。</p>
          </article>
          <article>
            <strong>広告は明示</strong>
            <p>広告・アフィリエイトを含む場合は、診断結果と購入導線で明示します。</p>
          </article>
        </div>
      </section>

      <AffiliateNote />
    </main>
  );
}
