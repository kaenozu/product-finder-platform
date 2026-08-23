import { describe, expect, it } from "vitest";
import type { QuestionDefinition } from "../../src/shared/domain/types";
import { decodeAnswersFromQuery, encodeAnswersToQuery } from "../../src/client/lib/flow-url";

const QUESTIONS: QuestionDefinition[] = [
  {
    key: "volume",
    title: "量は?",
    required: true,
    order: 0,
    options: [
      { value: "small", label: "少ない", next: "heat" },
      { value: "large", label: "多い", next: "heat" },
    ],
  },
  {
    key: "heat",
    title: "加熱は?",
    required: true,
    order: 1,
    options: [{ value: "ih", label: "IH", next: null }],
  },
];

describe("encodeAnswersToQuery", () => {
  it("key:value をカンマ連結する", () => {
    expect(encodeAnswersToQuery({ volume: "large", heat: "ih" })).toBe("volume:large,heat:ih");
  });

  it("空の回答は空文字列", () => {
    expect(encodeAnswersToQuery({})).toBe("");
  });
});

describe("decodeAnswersFromQuery", () => {
  it("正しいペアを復元する", () => {
    expect(decodeAnswersFromQuery("volume:large,heat:ih", QUESTIONS)).toEqual({
      volume: "large",
      heat: "ih",
    });
  });

  it("未知キー・不正値・不正形式を破棄する", () => {
    const decoded = decodeAnswersFromQuery(
      "unknown:x,volume:notavalue,broken,volume:small",
      QUESTIONS
    );
    expect(decoded).toEqual({ volume: "small" });
  });

  it("null/空は空オブジェクト", () => {
    expect(decodeAnswersFromQuery(null, QUESTIONS)).toEqual({});
    expect(decodeAnswersFromQuery("", QUESTIONS)).toEqual({});
  });
});
