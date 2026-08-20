import type { EvaluateResponse } from "../lib/api";
import type { CategoryCopy } from "../../shared/domain/types";
import { ProductCard } from "./ProductCard";
import { AffiliateNote } from "./AffiliateNote";
import { useEffect, useRef, useState } from "react";

interface Props {
  result: EvaluateResponse;
  copy: CategoryCopy;
  onRestart: () => void;
  onEditAnswers: () => void;
}

export function ResultScreen({ result, copy, onRestart, onEditAnswers }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section className="result" aria-live="polite">
      <p className="eyebrow">診断結果{result.status === "final" ? "・確定" : "・途中"}</p>
      <h2 ref={headingRef} tabIndex={-1}>
        {result.noMatch ? copy.resultNoMatchTitle : copy.resultTitle}
      </h2>
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
            条件に合う商品は{result.matchedCount}件。
            {result.matchedCount > result.candidates.length
              ? `上位${result.candidates.length}件を表示しています。`
              : ""}{" "}
            {result.status === "partial" && "すべての質問に答えるとより正確です。"}
          </p>
          <div className="candidates">
            {result.candidates.map((c, i) => (
              <ProductCard
                key={c.product.productId}
                candidate={c}
                rank={i + 1}
                maxScore={result.maxScore}
                scoreLabels={result.scoreLabels}
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

      <AffiliateNote />
    </section>
  );
}
