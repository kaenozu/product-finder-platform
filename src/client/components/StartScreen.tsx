import type { CategoryCopy } from "../../shared/domain/types";

interface Props {
  copy: CategoryCopy;
  onStart: () => void;
}

export function StartScreen({ copy, onStart }: Props) {
  return (
    <div className="start">
      <p className="eyebrow">{copy.appTitle}</p>
      <h1>{copy.heroTitle}</h1>
      <p className="lead">{copy.heroLead}</p>
      <ul className="benefits">
        {copy.benefits.map((b) => (
          <li key={b.title}>
            <strong>{b.title}</strong>
            <span>{b.text}</span>
          </li>
        ))}
      </ul>
      <button className="btn-primary" onClick={onStart} type="button">
        診断をはじめる
      </button>
      <p className="note">{copy.note}</p>
    </div>
  );
}
