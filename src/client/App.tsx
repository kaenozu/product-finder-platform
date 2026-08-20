import { useEffect, useRef, useState } from "react";
import type { ConfigResponse, EvaluateResponse } from "./lib/api";
import { fetchConfig, postEvaluate } from "./lib/api";
import { computeFlow } from "./lib/flow";
import { StartScreen } from "./components/StartScreen";
import { QuestionScreen } from "./components/QuestionScreen";
import { ResultScreen } from "./components/ResultScreen";

type Screen = "loading" | "start" | "questions" | "result";

// Worker側の canShowPartialResult と同じ現行契約。将来カテゴリごとに異なる場合は config 化する。
const PREVIEW_MIN_ANSWERS = 2;

function firstQuestionKey(config: ConfigResponse | null): string | null {
  if (!config) return null;
  return [...config.questions].sort((a, b) => a.order - b.order)[0]?.key ?? null;
}

export default function App() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRequestId = useRef(0);

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setConfig(c);
        setScreen("start");
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "設定の読み込みに失敗しました")
      );
  }, []);

  function invalidatePreview() {
    previewRequestId.current += 1;
    setPreviewLoading(false);
  }

  async function evaluate(cleanAnswers: Record<string, string>) {
    if (!config) return;
    invalidatePreview();
    setLoading(true);
    setError(null);
    try {
      const res = await postEvaluate(config.categoryKey, cleanAnswers);
      setResult(res);
      setAnswers(cleanAnswers);
      setScreen("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "診断に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function refreshPreview(cleanAnswers: Record<string, string>) {
    if (!config) return;
    const requestId = ++previewRequestId.current;
    setPreviewLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await postEvaluate(config.categoryKey, cleanAnswers);
      if (requestId !== previewRequestId.current) return;
      setResult(res);
    } catch (e) {
      if (requestId !== previewRequestId.current) return;
      setError(e instanceof Error ? e.message : "候補の更新に失敗しました");
    } finally {
      if (requestId === previewRequestId.current) {
        setPreviewLoading(false);
      }
    }
  }

  function handleStart() {
    setCurrentKey(firstQuestionKey(config));
    setScreen("questions");
  }

  function handleSelect(value: string) {
    if (!config || !currentKey) return;
    const flow = computeFlow(config.questions, { ...answers, [currentKey]: value });
    setError(null);
    if (flow.complete) {
      setResult(null);
      void evaluate(flow.clean);
    } else {
      setAnswers(flow.clean);
      setCurrentKey(flow.currentKey);
      // 既存APIの途中推薦条件（2問以上）を満たしたら、質問画面の候補を自動更新する。
      if (flow.answered >= PREVIEW_MIN_ANSWERS) {
        void refreshPreview(flow.clean);
      } else {
        invalidatePreview();
        setResult(null);
      }
    }
  }

  function handleBack() {
    if (!config) return;
    const flow = computeFlow(config.questions, answers);
    const prev = flow.path[flow.path.length - 2];
    if (!prev) return;
    const next = { ...flow.clean };
    delete next[prev];
    const nextFlow = computeFlow(config.questions, next);
    setAnswers(nextFlow.clean);
    setCurrentKey(nextFlow.currentKey);
    setError(null);
    if (nextFlow.answered >= PREVIEW_MIN_ANSWERS) {
      void refreshPreview(nextFlow.clean);
    } else {
      invalidatePreview();
      setResult(null);
    }
  }

  function handleOpenPreview() {
    if (result) setScreen("result");
  }

  function handleEditAnswers() {
    if (!config) return;
    const flow = computeFlow(config.questions, answers);
    if (flow.complete) {
      const lastKey = flow.path[flow.path.length - 1];
      const editableAnswers = { ...flow.clean };
      if (lastKey) delete editableAnswers[lastKey];
      const editableFlow = computeFlow(config.questions, editableAnswers);
      setAnswers(editableFlow.clean);
      setCurrentKey(editableFlow.currentKey);
      setResult(null);
    } else {
      setCurrentKey(flow.currentKey);
    }
    setScreen("questions");
  }

  function handleRestart() {
    invalidatePreview();
    setAnswers({});
    setResult(null);
    setCurrentKey(firstQuestionKey(config));
    setScreen("start");
  }

  if (error && !config) {
    return (
      <main>
        <p className="note error" role="alert">
          {error}
        </p>
        <button className="btn-primary" type="button" onClick={() => location.reload()}>
          再読み込み
        </button>
      </main>
    );
  }

  const question = config?.questions.find((q) => q.key === currentKey) ?? null;
  const flow = config ? computeFlow(config.questions, answers) : null;
  const previewResult = result?.status === "partial" ? result : null;

  return (
    <main>
      <header className="app-header">
        <span className="logo">{config?.copy.appTitle}</span>
        {screen === "questions" && result && (
          <button className="link" type="button" onClick={handleOpenPreview}>
            {result.noMatch ? "条件を確認" : result.status === "final" ? "結果へ" : "候補を詳しく"}
          </button>
        )}
      </header>

      {screen === "loading" && (
        <p className="note" role="status">
          読み込み中…
        </p>
      )}
      {screen === "start" && config && <StartScreen copy={config.copy} onStart={handleStart} />}
      {screen === "questions" && question && flow && (
        <QuestionScreen
          question={question}
          flow={flow}
          onSelect={handleSelect}
          onBack={handleBack}
          previewResult={previewResult}
          previewLoading={previewLoading}
          onOpenPreview={handleOpenPreview}
          loading={loading}
        />
      )}
      {screen === "result" && result && config && (
        <ResultScreen
          result={result}
          copy={config.copy}
          onRestart={handleRestart}
          onEditAnswers={handleEditAnswers}
        />
      )}
      {loading && screen === "questions" && (
        <p className="note" role="status">
          候補を計算しています…
        </p>
      )}
      {error && screen !== "loading" && (
        <p className="note error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
