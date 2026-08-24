import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandHome } from "../../src/client/BrandHome";
import { ResultPreviewSection } from "../../src/client/components/ResultPreviewSection";
import type { CategorySummary } from "../../src/client/lib/api";
import {
  isRenderablePreview,
  resolveTopPagePreview,
  type TopPagePreviewState,
} from "../../src/client/lib/result-preview";
import { getModule, listModules } from "../../src/shared/domain/registry";

/** worker api handleCategories と同じ対応でカテゴリモジュールからサマリを組む */
function summaryOf(module: ReturnType<typeof getModule>): CategorySummary {
  return {
    categoryKey: module.key,
    questionCount: module.questions.length,
    copy: {
      appTitle: module.copy.appTitle,
      heroTitle: module.copy.heroTitle,
      heroLead: module.copy.heroLead,
      resultTitle: module.copy.resultTitle,
      resultPreview: module.copy.resultPreview,
    },
  };
}

const VALID_PREVIEW = {
  candidateProduct: "テスト炊飯器 T-1",
  matchSummary: "回答条件と仕様を照合した表示例",
  reasons: ["理由その1", "理由その2"],
  weakPoint: "妥協点の例",
  difference: "他候補との違いの例",
};

/** API応答はクライアントで検証される前の生データ。不正形を含められるよう unknown 経由で組む */
function rawSummary(categoryKey: string, resultPreview: unknown): CategorySummary[] {
  return [
    {
      categoryKey,
      questionCount: 3,
      copy: {
        appTitle: categoryKey,
        heroTitle: categoryKey,
        heroLead: "",
        resultTitle: "",
        resultPreview,
      },
    },
  ] as unknown as CategorySummary[];
}

function renderSection(state: TopPagePreviewState): string {
  return renderToString(createElement(ResultPreviewSection, { state }));
}

describe("登録済みカテゴリごとの結果プレビュー（Issue #48）", () => {
  it("全登録カテゴリでプレビュー状態の解決と描画が例外なく行える", () => {
    const keys = listModules();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const state = resolveTopPagePreview([summaryOf(getModule(key))]);
      expect(["available", "unavailable"]).toContain(state.status);
      expect(() => renderSection(state)).not.toThrow();
    }
  });

  it("resultPreviewを持つカテゴリは検証済みデータとして採用されカード描画される", () => {
    let withPreview = 0;
    for (const key of listModules()) {
      const module = getModule(key);
      if (module.copy.resultPreview === undefined) continue;
      withPreview += 1;
      expect(isRenderablePreview(module.copy.resultPreview)).toBe(true);
      const state = resolveTopPagePreview([summaryOf(module)]);
      expect(state.status).toBe("available");
      if (state.status !== "available") throw new Error(`unavailable preview for ${key}`);
      expect(state.categoryKey).toBe(key);
      expect(state.preview).toEqual(module.copy.resultPreview);
      const html = renderSection(state);
      expect(html).toContain("第一候補");
      expect(html).toContain(state.preview.candidateProduct);
      expect(html).not.toContain("準備中");
    }
    // 現在のregistryでは rice-cooker が resultPreview を持つ
    expect(withPreview).toBeGreaterThan(0);
  });

  it("resultPreview未定義のカテゴリは明示的な無効状態にフォールバックする", () => {
    let withoutPreview = 0;
    for (const key of listModules()) {
      const module = getModule(key);
      if (module.copy.resultPreview !== undefined) continue;
      withoutPreview += 1;
      const state = resolveTopPagePreview([summaryOf(module)]);
      expect(state.status).toBe("unavailable");
      const html = renderSection(state);
      expect(html).toContain("準備中");
      expect(html).not.toContain("第一候補");
    }
    // 全カテゴリがresultPreviewを持つ間は該当なし。未定義カテゴリ追加時に自動的に有効化される
    expect(listModules().length).toBeGreaterThanOrEqual(withoutPreview);
  });
});

describe("欠損・不正なresultPreviewのフォールバック", () => {
  const brokenCases: Array<{ name: string; preview: unknown }> = [
    { name: "resultPreview欠落", preview: undefined },
    { name: "resultPreviewがnull", preview: null },
    { name: "resultPreviewが文字列", preview: "表示例" },
    { name: "candidateProductが空文字", preview: { ...VALID_PREVIEW, candidateProduct: "" } },
    { name: "matchSummaryが数値", preview: { ...VALID_PREVIEW, matchSummary: 123 } },
    { name: "reasons欠落", preview: { ...VALID_PREVIEW, reasons: undefined } },
    { name: "reasonsが空配列", preview: { ...VALID_PREVIEW, reasons: [] } },
    { name: "reasonsに非文字列が混入", preview: { ...VALID_PREVIEW, reasons: ["ok", 42] } },
    { name: "weakPoint欠落", preview: { ...VALID_PREVIEW, weakPoint: undefined } },
    { name: "differenceが空文字", preview: { ...VALID_PREVIEW, difference: "" } },
  ];

  it.each(brokenCases)("$name の場合は描画せず無効状態へフォールバックする", ({ preview }) => {
    expect(isRenderablePreview(preview)).toBe(false);
    const state = resolveTopPagePreview(rawSummary("broken-cat", preview));
    expect(state.status).toBe("unavailable");
    const html = renderSection(state);
    expect(html).toContain("準備中");
    expect(html).not.toContain("第一候補");
  });
});

describe("複数カテゴリ時の採用ロジック", () => {
  it("先頭の不完全なプレビューをスキップし、描画可能な最初のカテゴリを採用する", () => {
    const categories = [
      ...rawSummary("broken-cat", { ...VALID_PREVIEW, reasons: null }),
      ...rawSummary("valid-cat", VALID_PREVIEW),
    ];
    const state = resolveTopPagePreview(categories);
    expect(state.status).toBe("available");
    if (state.status !== "available") throw new Error("expected available state");
    expect(state.categoryKey).toBe("valid-cat");
    expect(renderSection(state)).toContain(VALID_PREVIEW.candidateProduct);
  });

  it("全カテゴリが不完全な場合は無効状態になる", () => {
    const categories = [...rawSummary("broken-a", {}), ...rawSummary("broken-b", undefined)];
    expect(resolveTopPagePreview(categories)).toEqual({ status: "unavailable" });
  });
});

describe("loading / empty状態", () => {
  it("categories未読み込み（null）はloadingとして何も描画しない", () => {
    expect(resolveTopPagePreview(null)).toEqual({ status: "loading" });
    expect(renderSection({ status: "loading" })).toBe("");
  });

  it("カテゴリ0件はemptyとして何も描画しない（空状態はカテゴリ一覧側で明示）", () => {
    expect(resolveTopPagePreview([])).toEqual({ status: "empty" });
    expect(renderSection({ status: "empty" })).toBe("");
  });
});

describe("トップページ本体", () => {
  it("BrandHomeの初期描画（読み込み中）が例外なく行える", () => {
    expect(() => renderToString(createElement(BrandHome))).not.toThrow();
  });
});
