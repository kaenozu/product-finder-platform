import type { EvaluateResponse } from "../lib/api";
import { ProductCard } from "./ProductCard";
import { useState } from "react";

interface Props {
  result: EvaluateResponse;
  onRestart: () => void;
  onEditAnswers: () => void;
}

export function ResultScreen({ result, onRestart, onEditAnswers }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section className="result" aria-live="polite">
      <p className="eyebrow">診断結果{result.status === "final" ? "・確定" : "・途中"}</p>
      <h2>{result.noMatch ? "条件に合う炊飯器が見つかりませんでした" : "あなたに合う炊飯器"}</h2>
      {result.warnings.length > 0 && (
        <div className="banner warn">
          {result.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      {result.noMatch ? (
        <div className="no-match">
          <p className="lead">
            選んだ条件（{result.noMatchReasons.join("、")}
            ）を満たす商品がカタログに見つかりませんでした。
          </p>
          <p className="note">
            条件を少し広げると見つかるかもしれません。いずれかを変更してお試しください。
          </p>
          <button className="btn-primary" type="button" onClick={onEditAnswers}>
            回答を変更する
          </button>
        </div>
      ) : (
        <>
          <p className="result-summary">
            {result.candidates.length}件の候補があります。{" "}
            {result.status === "partial" && "すべての質問に答えるとより正確です。"}
          </p>
          <div className="candidates">
            {result.candidates.map((c, i) => (
              <ProductCard
                key={c.product.productId}
                candidate={c}
                rank={i + 1}
                expanded={expanded === c.product.productId}
                onToggle={() =>
                  setExpanded(expanded === c.product.productId ? null : c.product.productId)
                }
              />
            ))}
          </div>
        </>
      )}

      <div className="actions">
        {!result.noMatch && (
          <button className="btn-ghost" type="button" onClick={onEditAnswers}>
            ← 回答を変更する
          </button>
        )}
        <button className="btn-ghost" type="button" onClick={onRestart}>
          最初からやり直す
        </button>
      </div>
    </section>
  );
}
