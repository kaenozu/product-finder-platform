import type { QuestionDefinition } from "../../shared/domain/types";
import type { EvaluateResponse } from "../lib/api";
import type { FlowState } from "../lib/flow";
import { LiveCandidates } from "./LiveCandidates";

interface Props {
  question: QuestionDefinition;
  flow: FlowState;
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
  onSelect,
  onBack,
  previewResult,
  previewLoading,
  onOpenPreview,
  loading,
}: Props) {
  const progress = flow.totalSteps > 0 ? flow.answered / flow.totalSteps : 0;

  return (
    <section className="question" aria-live="polite">
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
      <h2>{question.title}</h2>
      {question.description && <p className="lead">{question.description}</p>}

      <div className="options" role="group" aria-label={question.title}>
        {question.options.map((option) => (
          <button
            key={option.value}
            className="option"
            type="button"
            disabled={loading}
            aria-pressed={false}
            onClick={() => onSelect(option.value)}
          >
            <span className="option-label">{option.label}</span>
            {option.description && <span className="option-desc">{option.description}</span>}
          </button>
        ))}
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
