import { useEffect, useState } from "react";
import type { ConfigResponse, EvaluateResponse } from "./lib/api";
import { fetchConfig, postEvaluate } from "./lib/api";
import { computeFlow } from "./lib/flow";
import { StartScreen } from "./components/StartScreen";
import { QuestionScreen } from "./components/QuestionScreen";
import { ResultScreen } from "./components/ResultScreen";

type Screen = "loading" | "start" | "questions" | "result";

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
  const [error, setError] = useState<string | null>(null);

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

  async function evaluate(cleanAnswers: Record<string, string>) {
    if (!config) return;
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

  function handleStart() {
    setCurrentKey(firstQuestionKey(config));
    setScreen("questions");
  }

  function handleSelect(value: string) {
    if (!config || !currentKey) return;
    const flow = computeFlow(config.questions, { ...answers, [currentKey]: value });
    if (flow.complete) {
      void evaluate(flow.clean);
    } else {
      setAnswers(flow.clean);
      setCurrentKey(flow.currentKey);
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
  }

  function handlePreview() {
    if (!config) return;
    const flow = computeFlow(config.questions, answers);
    void evaluate(flow.clean);
  }

  function handleEditAnswers() {
    if (!config) return;
    const flow = computeFlow(config.questions, answers);
    setCurrentKey(flow.complete ? (flow.path[flow.path.length - 1] ?? null) : flow.currentKey);
    setScreen("questions");
  }

  function handleRestart() {
    setAnswers({});
    setResult(null);
    setCurrentKey(firstQuestionKey(config));
    setScreen("start");
  }

  if (error && !config) {
    return (
      <main>
        <p className="note">{error}</p>
        <button className="btn-primary" type="button" onClick={() => location.reload()}>
          再読み込み
        </button>
      </main>
    );
  }

  const question = config?.questions.find((q) => q.key === currentKey) ?? null;
  const flow = config ? computeFlow(config.questions, answers) : null;

  return (
    <main>
      <header className="app-header">
        <span className="logo">炊飯器選び診断</span>
        {screen === "questions" && flow && (
          <>
            {result ? (
              <button className="link" type="button" onClick={() => setScreen("result")}>
                結果へ
              </button>
            ) : (
              flow.answered >= 2 && (
                <button className="link" type="button" onClick={handlePreview}>
                  候補を見る
                </button>
              )
            )}
          </>
        )}
      </header>

      {screen === "loading" && <p className="note">読み込み中…</p>}
      {screen === "start" && <StartScreen onStart={handleStart} />}
      {screen === "questions" && question && flow && (
        <QuestionScreen
          question={question}
          flow={flow}
          onSelect={handleSelect}
          onBack={handleBack}
          onPreview={handlePreview}
          loading={loading}
        />
      )}
      {screen === "result" && result && (
        <ResultScreen result={result} onRestart={handleRestart} onEditAnswers={handleEditAnswers} />
      )}
      {loading && screen === "questions" && <p className="note">候補を計算しています…</p>}
      {error && screen !== "loading" && <p className="note error">{error}</p>}
    </main>
  );
}
