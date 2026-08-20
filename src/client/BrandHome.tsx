import { useEffect, useState } from "react";
import { fetchCategories } from "./lib/api";
import type { CategorySummary } from "./lib/api";
import { AffiliateNote } from "./components/AffiliateNote";

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

  return (
    <main>
      <header className="app-header">
        <BrandLogo />
      </header>

      <section className="brand-hero">
        <p className="eyebrow">家電・商品選びの診断サービス</p>
        <h1>
          pitariko<span className="brand-tag">— 条件に合う理由まで見える、商品選び。</span>
        </h1>
        <p className="lead">
          公式スペックと価格を元に、あなたの条件に合う商品と、その理由（・惜しい点）を提示します。
          数問答えるだけで、納得できる候補が見つかります。
        </p>
      </section>

      <section className="category-list" aria-label="診断カテゴリ">
        <h2>診断を選ぶ</h2>
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
          {categories?.map((c) => (
            <a key={c.categoryKey} className="category-card" href={`/${c.categoryKey}`}>
              <p className="eyebrow">{c.copy.appTitle}</p>
              <h3>{c.copy.heroTitle}</h3>
              <p>{c.copy.heroLead}</p>
              <span className="category-cta">診断をはじめる →</span>
            </a>
          ))}
        </div>
      </section>

      <AffiliateNote />
    </main>
  );
}
