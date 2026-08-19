import type { QuestionDefinition } from "../../shared/domain/types";
import type { FlowState } from "../lib/flow";

interface Props {
  question: QuestionDefinition;
  flow: FlowState;
  onSelect: (value: string) => void;
  onBack: () => void;
  onPreview: () => void;
  loading: boolean;
}

export function QuestionScreen({ question, flow, onSelect, onBack, onPreview, loading }: Props) {
  const canPreview = flow.answered >= 2;
  const progress = flow.estimatedTotal > 0 ? flow.answered / flow.estimatedTotal : 0;

  return (
    <section className="question" aria-live="polite">
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={flow.answered}
        aria-valuemax={flow.estimatedTotal}
      >
        <div
          className="progress-fill"
          style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
        />
      </div>
      <p className="eyebrow">
        質問 {Math.min(flow.answered + 1, flow.estimatedTotal)} / {flow.estimatedTotal}
      </p>
      <h2>{question.title}</h2>
      {question.description && <p className="lead">{question.description}</p>}

      <div className="options" role="radiogroup" aria-label={question.title}>
        {question.options.map((option) => (
          <button
            key={option.value}
            className="option"
            type="button"
            disabled={loading}
            onClick={() => onSelect(option.value)}
          >
            <span className="option-label">{option.label}</span>
            {option.description && <span className="option-desc">{option.description}</span>}
          </button>
        ))}
      </div>

      <div className="actions">
        {flow.answered > 0 && (
          <button className="btn-ghost" type="button" onClick={onBack} disabled={loading}>
            ← 戻る
          </button>
        )}
        {canPreview && !loading && (
          <button className="btn-primary" type="button" onClick={onPreview}>
            この条件で候補を見る
          </button>
        )}
      </div>
    </section>
  );
}
