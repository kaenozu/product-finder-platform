import { useEffect, useMemo, useState } from "react";
import { fetchConfig } from "./lib/api";
import type { ConfigResponse } from "./lib/api";
import { computeFlow } from "./lib/flow";
import { useDiagnosisFlow } from "./lib/useDiagnosisFlow";
import { StartScreen } from "./components/StartScreen";
import { QuestionScreen } from "./components/QuestionScreen";
import { ResultScreen } from "./components/ResultScreen";

interface AppProps {
  categoryKey: string;
}

export default function App({ categoryKey }: AppProps) {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // URL共有（?a=…）の生クエリ値。初回マウント時に一度だけ取り込む
  const urlAnswers = useMemo(() => new URLSearchParams(window.location.search).get("a"), []);
  const flow = useDiagnosisFlow(config, urlAnswers);

  useEffect(() => {
    let cancelled = false;
    fetchConfig(categoryKey)
      .then((c) => {
        if (cancelled) return;
        document.title = `${c.copy.appTitle} — ${c.copy.heroTitle}`;
        const meta = document.querySelector('meta[name="description"]');
        if (meta) meta.setAttribute("content", c.copy.heroLead);
        setConfig(c);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "設定の読み込みに失敗しました";
        // 未知カテゴリ（URL直打ちなど）はポータルへ案内
        if (message.includes("unsupported_category")) {
          window.location.replace("/");
          return;
        }
        setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryKey]);

  const { state } = flow;

  if (loadError && !config) {
    return (
      <main>
        <p className="note error" role="alert">
          {loadError}
        </p>
        <button className="btn-primary" type="button" onClick={() => location.reload()}>
          再読み込み
        </button>
      </main>
    );
  }

  const question = config?.questions.find((q) => q.key === state.currentKey) ?? null;
  const computedFlow = config ? computeFlow(config.questions, state.answers) : null;
  const previewResult = state.result?.status === "partial" ? state.result : null;

  return (
    <main>
      <header className="app-header">
        <span className="logo">
          <a href="/" className="logo-brand" aria-label="pitariko トップへ">
            <img className="logo-mark" src="/favicon.svg" alt="" width="20" height="20" />
            pitariko
          </a>
          <span className="logo-sep">/</span>
          {config?.copy.appTitle}
        </span>
        {state.screen === "questions" && state.result && (
          <button className="link" type="button" onClick={flow.handleOpenPreview}>
            {state.result.noMatch
              ? "条件を確認"
              : state.result.status === "final"
                ? "結果へ"
                : "候補を詳しく"}
          </button>
        )}
      </header>

      {(!config || !flow.restoreDone) && !loadError && (
        <p className="note" role="status">
          読み込み中…
        </p>
      )}
      {config && flow.restoreDone && state.screen === "start" && (
        <StartScreen copy={config.copy} onStart={flow.handleStart} />
      )}
      {state.screen === "questions" && question && computedFlow && (
        <QuestionScreen
          question={question}
          flow={computedFlow}
          answers={state.answers}
          onSelect={flow.handleSelect}
          onBack={flow.handleBack}
          previewResult={previewResult}
          previewLoading={flow.previewLoading}
          onOpenPreview={flow.handleOpenPreview}
          loading={flow.loading}
        />
      )}
      {state.screen === "result" && state.result && config && (
        <ResultScreen
          result={state.result}
          copy={config.copy}
          onRestart={flow.handleRestart}
          onEditAnswers={flow.handleEditAnswers}
        />
      )}
      {flow.loading && state.screen === "questions" && (
        <p className="note" role="status">
          候補を計算しています…
        </p>
      )}
      {flow.error && (
        <p className="note error" role="alert">
          {flow.error}
        </p>
      )}
    </main>
  );
}
