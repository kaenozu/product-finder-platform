import type { QuestionDefinition } from "../../shared/domain/types";
import { useEffect, useRef } from "react";
import type { EvaluateResponse } from "../lib/api";
import type { FlowState } from "../lib/flow";
import { LiveCandidates } from "./LiveCandidates";

interface Props {
  question: QuestionDefinition;
  flow: FlowState;
  /** 現在の回答（選択済みオプションの表現に使用） */
  answers?: Record<string, string>;
  onSelect: (value: string) => void;
  onBack: () => void;
  previewResult: EvaluateResponse | null;
  previewLoading: boolean;
  onOpenPreview: () => void;
  loading: boolean;
}

export function QuestionScreen({
  question,
  flow,
  answers,
  onSelect,
  onBack,
  previewResult,
  previewLoading,
  onOpenPreview,
  loading,
}: Props) {
  const progress = flow.totalSteps > 0 ? flow.answered / flow.totalSteps : 0;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [question.key]);

  const selectedValue = answers?.[question.key] ?? null;

  return (
    <section className="question">
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={flow.answered}
        aria-valuemin={0}
        aria-valuemax={flow.totalSteps}
        aria-valuetext={`質問${flow.answered + 1}（全${flow.totalSteps}問程度）`}
      >
        <div
          className="progress-fill"
          style={{ width: `${Math.min(100, Math.max(0, Math.round(progress * 100)))}%` }}
        />
      </div>
      <p className="eyebrow">質問 {flow.answered + 1}</p>
      <h2 ref={headingRef} tabIndex={-1}>
        {question.title}
      </h2>
      {question.description && <p className="lead">{question.description}</p>}

      <div className="options" role="group" aria-label={question.title}>
        {question.options.map((option) => {
          const selected = selectedValue === option.value;
          return (
            <button
              key={option.value}
              className={selected ? "option selected" : "option"}
              type="button"
              disabled={loading}
              aria-pressed={selected}
              onClick={() => onSelect(option.value)}
            >
              <span className="option-label">{option.label}</span>
              {option.description && <span className="option-desc">{option.description}</span>}
            </button>
          );
        })}
      </div>

      {flow.answered > 0 && (
        <div className="actions">
          <button className="btn-ghost" type="button" onClick={onBack} disabled={loading}>
            ← 戻る
          </button>
        </div>
      )}

      <LiveCandidates result={previewResult} loading={previewLoading} onOpen={onOpenPreview} />
    </section>
  );
}
