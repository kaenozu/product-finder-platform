import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { QuestionDefinition } from "../../shared/domain/types";
import type { ConfigResponse } from "./api";
import { postEvaluate } from "./api";
import { computeFlow } from "./flow";
import { decodeAnswersFromQuery, syncAnswersToUrl } from "./flow-url";
import {
  diagnosisReducer,
  popLastAnswer,
  type DiagnosisAction,
  type DiagnosisState,
} from "./diagnosis-flow";

function firstQuestionKey(questions: QuestionDefinition[]): string | null {
  return [...questions].sort((a, b) => a.order - b.order)[0]?.key ?? null;
}

/**
 * 診断フロー全体の状態とAPI呼び出しを管理するフック。
 * 画面遷移・回答・結果の整合は diagnosisReducer に一元化し、
 * ここでは非同期評価（確定/暫定）とstaleレスポンス排除のみを担う。
 *
 * @param urlAnswers URL共有（?a=…）の生クエリ値。config解決後に1回だけ復元する
 */
export function useDiagnosisFlow(config: ConfigResponse | null, urlAnswers?: string | null) {
  const questions = useMemo(() => config?.questions ?? [], [config]);
  const urlAnswersRef = useRef(urlAnswers);
  const restoredRef = useRef(false);
  const [state, dispatch] = useReducer(diagnosisReducer, undefined, (): DiagnosisState => ({
    screen: "start",
    answers: {},
    currentKey: null,
    result: null,
  }));
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewRequestId = useRef(0);
  const evaluating = useRef(false);

  // 非同期ハンドラから最新状態を参照するためのミラー + URL共有の同期
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    if (config) syncAnswersToUrl(state.answers);
  }, [state, config]);

  const invalidatePreview = useCallback(() => {
    previewRequestId.current += 1;
    setPreviewLoading(false);
  }, []);

  const evaluate = useCallback(
    async (cleanAnswers: Record<string, string>) => {
      if (!config || evaluating.current) return;
      invalidatePreview();
      evaluating.current = true;
      setLoading(true);
      setError(null);
      try {
        const res = await postEvaluate(config.categoryKey, cleanAnswers);
        dispatch({ type: "show_result", result: res });
      } catch (e) {
        setError(e instanceof Error ? e.message : "診断に失敗しました");
      } finally {
        evaluating.current = false;
        setLoading(false);
      }
    },
    [config, invalidatePreview]
  );

  // URL共有（?a=…）からの復元。config解決後に最初の1回だけ実行する。
  // フック内で行うことで、初回レンダーのクロージャ（config未解決）に依存しない。
  const [restoreDone, setRestoreDone] = useState(!urlAnswers);
  useEffect(() => {
    if (!config || restoredRef.current) return;
    restoredRef.current = true;
    const answers = decodeAnswersFromQuery(urlAnswersRef.current, config.questions);
    if (Object.keys(answers).length === 0) {
      setRestoreDone(true);
      return;
    }
    const flow = computeFlow(config.questions, answers);
    // dispatchとsetRestoreDoneは同一バッチで適用されるため開始画面の点滅はない
    setRestoreDone(true);
    dispatch({
      type: "restore",
      answers: flow.clean,
      currentKey: flow.currentKey ?? firstQuestionKey(config.questions),
    });
    if (flow.complete) {
      void evaluate(flow.clean);
    }
  }, [config, evaluate]);

  const refreshPreview = useCallback(
    async (cleanAnswers: Record<string, string>) => {
      if (!config) return;
      const requestId = ++previewRequestId.current;
      setPreviewLoading(true);
      setError(null);
      try {
        const res = await postEvaluate(config.categoryKey, cleanAnswers);
        if (requestId !== previewRequestId.current) return;
        dispatch({ type: "update_preview", result: res });
      } catch (e) {
        if (requestId !== previewRequestId.current) return;
        setError(e instanceof Error ? e.message : "候補の更新に失敗しました");
      } finally {
        if (requestId === previewRequestId.current) {
          setPreviewLoading(false);
        }
      }
    },
    [config]
  );

  /**
   * 暫定候補の開始条件（partialEligibility.minAnswers）を満たしたら
   * 質問画面の候補を更新する。確定評価と暫定評価の分岐判断を一箇所に集約。
   */
  const advanceAfterAnswerChange = useCallback(
    (flow: { complete: boolean; clean: Record<string, string> }) => {
      if (flow.complete) {
        void evaluate(flow.clean);
        return;
      }
      if (Object.keys(flow.clean).length >= (config?.partialEligibility.minAnswers ?? Infinity)) {
        void refreshPreview(flow.clean);
      } else {
        invalidatePreview();
        dispatch({ type: "clear_result" });
      }
    },
    [config, evaluate, refreshPreview, invalidatePreview]
  );

  const handleStart = useCallback(() => {
    dispatch({ type: "start", firstKey: firstQuestionKey(questions) ?? "" });
  }, [questions]);

  const handleSelect = useCallback(
    (value: string) => {
      const current = stateRef.current;
      if (!current.currentKey) return;
      const flow = computeFlow(questions, { ...current.answers, [current.currentKey]: value });
      setError(null);
      dispatch({
        type: "select",
        answers: flow.clean,
        currentKey: flow.complete ? current.currentKey : flow.currentKey,
      });
      advanceAfterAnswerChange(flow);
    },
    [questions, advanceAfterAnswerChange]
  );

  const handleBack = useCallback(() => {
    const popped = popLastAnswer(questions, stateRef.current.answers);
    if (!popped) return;
    setError(null);
    dispatch({ type: "goto", answers: popped.answers, currentKey: popped.currentKey });
    advanceAfterAnswerChange({ complete: false, clean: popped.answers });
  }, [questions, advanceAfterAnswerChange]);

  const handleOpenPreview = useCallback(() => {
    if (stateRef.current.result) {
      dispatch({ type: "open_result" });
    }
  }, []);

  const handleEditAnswers = useCallback(() => {
    const popped = popLastAnswer(questions, stateRef.current.answers);
    if (!popped) return;
    setError(null);
    invalidatePreview();
    // 質問画面へ戻り、最後に回答した質問から編集を再開する
    dispatch({ type: "restore", answers: popped.answers, currentKey: popped.currentKey });
  }, [questions, invalidatePreview]);

  const handleRestart = useCallback(() => {
    invalidatePreview();
    setError(null);
    dispatch({ type: "restart", firstKey: firstQuestionKey(questions) ?? "" });
  }, [questions, invalidatePreview]);

  return {
    state,
    loading,
    previewLoading,
    error,
    setError,
    /** URL復元処理が完了（復元不要確定を含む）。開始画面表示の抑止に使う */
    restoreDone,
    handleStart,
    handleSelect,
    handleBack,
    handleOpenPreview,
    handleEditAnswers,
    handleRestart,
  };
}

export type { DiagnosisAction };
