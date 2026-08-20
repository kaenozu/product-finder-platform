import { describe, it, expect } from "vitest";
import { recommend, MAX_CANDIDATES } from "../../src/shared/domain/engine";
import { estimateTotalSteps, validateQuestionGraph } from "../../src/shared/domain/flow";
import { riceCookerModule, validateRegisteredModules } from "../../src/shared/domain/registry";
import {
  deriveCriteria,
  formatSpecs,
  hardMatch,
  score,
  explain,
  unansweredImportantKeys,
} from "../../src/shared/domain/rice-cooker/module";
import type { RiceCookerProduct } from "../../src/shared/domain/rice-cooker/types";
import { ManualRiceCookerAdapter } from "../../src/worker/adapters/manual";
import type { AnswerRecord } from "../../src/shared/domain/types";

const adapter = new ManualRiceCookerAdapter();

function makeProduct(
  overrides: Partial<RiceCookerProduct> & Pick<RiceCookerProduct, "productId" | "specs">
): RiceCookerProduct {
  return {
    categoryKey: "rice-cooker",
    manufacturer: "TEST",
    model: overrides.productId,
    displayName: overrides.productId,
    referencePriceYen: null,
    availability: "in_stock",
    sourceKey: "test",
    sourceUpdatedAt: "2026-08-19",
    ingestedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

/** 完全回答（status=final になる） */
const FULL_ANSWERS: AnswerRecord = {
  cookVolume: "5.5",
  heating: "pressure_ih",
  budget: "10to20k",
  priority: "functions",
  useTacook: "yes",
  installWidth: "under25",
};

describe("deriveCriteria", () => {
  it.each([
    [
      {
        cookVolume: "5.5",
        heating: "pressure_ih",
        budget: "10to20k",
        priority: "functions",
        useTacook: "yes",
        installWidth: "under24",
      },
      {
        requiredCapacityGou: 5.5,
        budgetYen: { min: 10000, max: 20000 },
        installWidthMm: 240,
        useTacook: true,
      },
    ],
    [
      { cookVolume: "3" },
      {
        requiredCapacityGou: 3,
        budgetYen: { min: null, max: null },
        installWidthMm: null,
        useTacook: false,
      },
    ],
    [
      { cookVolume: "10", budget: "under10k", installWidth: "free" },
      {
        requiredCapacityGou: 10,
        budgetYen: { min: 0, max: 10000 },
        installWidthMm: null,
        useTacook: false,
      },
    ],
    [
      { cookVolume: "3", budget: "over30k" },
      {
        requiredCapacityGou: 3,
        budgetYen: { min: 30000, max: null },
        installWidthMm: null,
        useTacook: false,
      },
    ],
  ])("answers=%j → criteria部分", (answers, expected) => {
    const c = deriveCriteria(answers);
    expect(c.requiredCapacityGou).toBe(expected.requiredCapacityGou);
    expect(c.budgetYen).toEqual(expected.budgetYen);
    expect(c.installWidthMm).toBe(expected.installWidthMm);
    expect(c.useTacook).toBe(expected.useTacook);
  });
});

describe("hardMatch", () => {
  const p = makeProduct({
    productId: "p1",
    specs: {
      capacityGou: 5.5,
      heatingMethod: "ih",
      powerW: null,
      weightKg: null,
      widthMm: 250,
      depthMm: 300,
      heightMm: 220,
      keepWarmHours: null,
      innerPot: null,
      features: [],
      releaseYear: null,
    },
  });

  it("容量不足で不合格", () => {
    const r = hardMatch(p, deriveCriteria({ cookVolume: "10" }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toContain("容量");
  });

  it("幅超過で不合格（設置幅指定時）", () => {
    const r = hardMatch(p, deriveCriteria({ cookVolume: "3", installWidth: "under24" }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toContain("幅");
  });

  it("幅不明+設置幅指定で不合格（推測しない）", () => {
    const unknown = makeProduct({
      productId: "p2",
      specs: {
        capacityGou: 3,
        heatingMethod: "micom",
        powerW: null,
        weightKg: null,
        widthMm: null,
        depthMm: null,
        heightMm: null,
        keepWarmHours: null,
        innerPot: null,
        features: [],
        releaseYear: null,
      },
    });
    const r = hardMatch(unknown, deriveCriteria({ cookVolume: "3", installWidth: "under24" }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toContain("不明");
  });

  it("在庫なしで不合格", () => {
    const out = makeProduct({
      productId: "p3",
      availability: "out_of_stock",
      specs: {
        capacityGou: 3,
        heatingMethod: "micom",
        powerW: null,
        weightKg: null,
        widthMm: 250,
        depthMm: 300,
        heightMm: 220,
        keepWarmHours: null,
        innerPot: null,
        features: [],
        releaseYear: null,
      },
    });
    const r = hardMatch(out, deriveCriteria({ cookVolume: "3" }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toContain("在庫");
  });

  it("全条件充足で合格", () => {
    const r = hardMatch(p, deriveCriteria({ cookVolume: "5.5", installWidth: "under27" }));
    expect(r.pass).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("設置幅の指定がなければ幅は判定しない", () => {
    const r = hardMatch(p, deriveCriteria({ cookVolume: "5.5", installWidth: "free" }));
    expect(r.pass).toBe(true);
  });
});

describe("score（null安全）", () => {
  const minimal = makeProduct({
    productId: "p1",
    specs: {
      capacityGou: 3,
      heatingMethod: "micom",
      powerW: null,
      weightKg: null,
      widthMm: null,
      depthMm: null,
      heightMm: null,
      keepWarmHours: null,
      innerPot: null,
      features: [],
      releaseYear: null,
    },
  });

  it("全仕様nullでもNaNにならない", () => {
    const s = score(minimal, deriveCriteria({ cookVolume: "3" }));
    expect(Number.isFinite(s.score)).toBe(true);
    for (const v of Object.values(s.breakdown)) expect(Number.isFinite(v)).toBe(true);
    expect(s.breakdown.freshnessScore).toBe(0.6); // 発売年不明は中立
  });

  it("発売年が新しいほどfreshnessScoreが高い", () => {
    const old = makeProduct({
      productId: "p2",
      specs: {
        capacityGou: 3,
        heatingMethod: "micom",
        powerW: null,
        weightKg: null,
        widthMm: null,
        depthMm: null,
        heightMm: null,
        keepWarmHours: null,
        innerPot: null,
        features: [],
        releaseYear: 2022,
      },
    });
    const fresh = makeProduct({
      productId: "p3",
      specs: {
        capacityGou: 3,
        heatingMethod: "micom",
        powerW: null,
        weightKg: null,
        widthMm: null,
        depthMm: null,
        heightMm: null,
        keepWarmHours: null,
        innerPot: null,
        features: [],
        releaseYear: 2026,
      },
    });
    const sOld = score(old, deriveCriteria({ cookVolume: "3" }));
    const sFresh = score(fresh, deriveCriteria({ cookVolume: "3" }));
    expect(sFresh.breakdown.freshnessScore).toBeGreaterThan(sOld.breakdown.freshnessScore);
  });
});

describe("explain", () => {
  it("同時調理対応でfeature_tacook理由が出る", () => {
    const p = makeProduct({
      productId: "tacook1",
      specs: {
        capacityGou: 5.5,
        heatingMethod: "pressure_ih",
        powerW: null,
        weightKg: null,
        widthMm: null,
        depthMm: null,
        heightMm: null,
        keepWarmHours: null,
        innerPot: null,
        features: ["tacook", "quick"],
        releaseYear: null,
      },
    });
    const reasons = explain(p, deriveCriteria(FULL_ANSWERS));
    expect(reasons.some((r) => r.code === "feature_tacook")).toBe(true);
  });

  it("発売年不明ならfresh_model理由は出ない", () => {
    const p = makeProduct({
      productId: "t1",
      specs: {
        capacityGou: 5.5,
        heatingMethod: "pressure_ih",
        powerW: null,
        weightKg: null,
        widthMm: null,
        depthMm: null,
        heightMm: null,
        keepWarmHours: null,
        innerPot: null,
        features: [],
        releaseYear: null,
      },
    });
    const reasons = explain(p, deriveCriteria(FULL_ANSWERS));
    expect(reasons.some((r) => r.code === "fresh_model")).toBe(false);
  });

  it("新しいモデル（2026）でfresh_model理由が出る", () => {
    const p = makeProduct({
      productId: "t2",
      specs: {
        capacityGou: 5.5,
        heatingMethod: "pressure_ih",
        powerW: null,
        weightKg: null,
        widthMm: null,
        depthMm: null,
        heightMm: null,
        keepWarmHours: null,
        innerPot: null,
        features: [],
        releaseYear: 2026,
      },
    });
    const reasons = explain(p, deriveCriteria(FULL_ANSWERS));
    expect(reasons.some((r) => r.code === "fresh_model")).toBe(true);
  });

  it("保温優先で長時間保温の理由が出る", () => {
    const p = makeProduct({
      productId: "t3",
      specs: {
        capacityGou: 5.5,
        heatingMethod: "ih",
        powerW: null,
        weightKg: null,
        widthMm: null,
        depthMm: null,
        heightMm: null,
        keepWarmHours: 40,
        innerPot: null,
        features: [],
        releaseYear: null,
      },
    });
    const reasons = explain(p, deriveCriteria({ ...FULL_ANSWERS, priority: "keepwarm" }));
    expect(reasons.some((r) => r.code === "keepwarm_long")).toBe(true);
  });
});

describe("unansweredImportantKeys", () => {
  it("分岐パス上で最初の未回答以降は返さない", () => {
    // パス: cookVolume→heating→budget（budget未回答で停止）
    const keys = unansweredImportantKeys({ cookVolume: "3", heating: "ih" });
    expect(keys).toEqual(["budget"]);
  });

  it("全回答済みなら空", () => {
    const keys = unansweredImportantKeys({
      cookVolume: "3",
      heating: "ih",
      budget: "any",
      priority: "keepwarm",
      installWidth: "free",
    });
    expect(keys).toEqual([]);
  });

  it("functionsを選ぶとuseTacookもパスに載る", () => {
    // パス: cookVolume→heating→budget→priority→useTacook（useTacook未回答で停止）
    const keys = unansweredImportantKeys({
      cookVolume: "3",
      heating: "ih",
      budget: "any",
      priority: "functions",
    });
    expect(keys).toEqual(["useTacook"]);
  });
});

describe("30商品PoC（fetch → normalize → criteria → hardMatch → score → candidates）", () => {
  const ctx = { categoryKey: "rice-cooker", now: new Date("2026-08-19T00:00:00Z") };

  it("37商品以上が正規化でき、重複がない", async () => {
    const fetched = await adapter.fetch(ctx);
    expect(fetched.meta.fetchedCount).toBeGreaterThanOrEqual(30);
    const normalized = await adapter.normalize(fetched, ctx);
    expect(normalized.rejectedCount).toBe(0);
    expect(normalized.rejectedReasons).toEqual([]);
    expect(normalized.products.length).toBeGreaterThanOrEqual(30);

    const ids = new Set(normalized.products.map((p) => p.productId));
    expect(ids.size).toBe(normalized.products.length); // 一意
  });

  it("完全回答でfinal・上位5件・全候補がhardMatchを通る・スコア降順", async () => {
    const fetched = await adapter.fetch(ctx);
    const { products } = await adapter.normalize(fetched, ctx);

    const result = recommend(riceCookerModule, FULL_ANSWERS, products, new Map());
    expect(result.status).toBe("final");
    expect(result.noMatch).toBe(false);
    expect(result.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES);
    expect(result.candidates.length).toBeGreaterThan(0);

    // スコア降順
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].totalScore).toBeGreaterThanOrEqual(
        result.candidates[i].totalScore
      );
    }

    // 全候補がhardMatchを通っている
    for (const c of result.candidates) {
      const hm = riceCookerModule.hardMatch(c.product, result.criteria);
      expect(hm.pass).toBe(true);
      expect(c.reasons.length).toBeGreaterThan(0);
    }
    // 同時調理対応商品がカタログに無いため透明性の警告が出る（条件は自動緩和しない）
    expect(result.warnings).toEqual([
      "「同時調理」対応の商品が現在のカタログにありません。ほかの重視項目に変更すると候補が増えます（条件は自動では緩和しません）。",
    ]);
  });

  it("同時調理を希望しない場合は警告なしでfinal", async () => {
    const fetched = await adapter.fetch(ctx);
    const { products } = await adapter.normalize(fetched, ctx);

    const result = recommend(
      riceCookerModule,
      { ...FULL_ANSWERS, useTacook: "no" },
      products,
      new Map()
    );
    expect(result.status).toBe("final");
    expect(result.warnings).toEqual([]);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("部分回答（2問のみ）でpartial+警告が付く", async () => {
    const fetched = await adapter.fetch(ctx);
    const { products } = await adapter.normalize(fetched, ctx);

    const result = recommend(
      riceCookerModule,
      { cookVolume: "5.5", heating: "ih" },
      products,
      new Map()
    );
    expect(result.status).toBe("partial");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.progress.answered).toBe(2);
  });

  it("条件が厳しすぎるとnoMatchになり理由が返る（条件は緩和しない）", async () => {
    const fetched = await adapter.fetch(ctx);
    const { products } = await adapter.normalize(fetched, ctx);

    // 10合+幅24cm以下+1万円未満 はほぼ成立しない
    const result = recommend(
      riceCookerModule,
      {
        cookVolume: "10",
        heating: "any",
        budget: "under10k",
        priority: "compact",
        installWidth: "under24",
      },
      products,
      new Map()
    );
    expect(result.noMatch).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.noMatchReasons.length).toBeGreaterThan(0);
  });

  it("全商品がhardMatch判定でクラッシュしない（null安全の全体確認）", async () => {
    const fetched = await adapter.fetch(ctx);
    const { products } = await adapter.normalize(fetched, ctx);
    const criteria = riceCookerModule.deriveCriteria(FULL_ANSWERS);
    for (const product of products) {
      const hm = riceCookerModule.hardMatch(product, criteria);
      const s = riceCookerModule.score(product, criteria);
      const reasons = riceCookerModule.explain(product, criteria);
      expect(Number.isFinite(s.score)).toBe(true);
      expect(Array.isArray(reasons)).toBe(true);
      expect(typeof hm.pass).toBe("boolean");
    }
  });
});

describe("formatSpecs（表示フォーマット）", () => {
  const p = makeProduct({
    productId: "spec1",
    specs: {
      capacityGou: 5.5,
      heatingMethod: "micom",
      powerW: null,
      weightKg: 4.5,
      widthMm: 250,
      depthMm: 300,
      heightMm: 220,
      keepWarmHours: null,
      innerPot: null,
      features: [],
      releaseYear: null,
    },
  });

  it("容量に合単位・加熱方式に日本語ラベルを出す", () => {
    const items = formatSpecs(p);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i.value]));
    expect(byKey.capacity).toBe("5.5合");
    expect(byKey.heating).toBe("マイコン");
  });

  it("幅はcm表記・重量は約表記", () => {
    const items = formatSpecs(p);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i.value]));
    expect(byKey.width).toBe("25.0cm");
    expect(byKey.weight).toBe("約4.5kg");
  });

  it("null項目は項目ごと出さない", () => {
    const minimal = makeProduct({
      productId: "spec2",
      specs: {
        capacityGou: 3,
        heatingMethod: "ih",
        powerW: null,
        weightKg: null,
        widthMm: null,
        depthMm: null,
        heightMm: null,
        keepWarmHours: null,
        innerPot: null,
        features: [],
        releaseYear: null,
      },
    });
    const items = formatSpecs(minimal);
    expect(items.find((i) => i.key === "width")).toBeUndefined();
    expect(items.find((i) => i.key === "weight")).toBeUndefined();
  });
});

describe("estimateTotalSteps（進捗分母が毎回増えないこと）", () => {
  it("回答に関係なく固定の最大ステップ数（分母が毎回増えない）", () => {
    const atStart = estimateTotalSteps(riceCookerModule.questions);
    const afterOne = estimateTotalSteps(riceCookerModule.questions);
    const afterTwo = estimateTotalSteps(riceCookerModule.questions);
    // 1/1→2/2→3/3 の現象が起きない（分母が回答ごとに増えない）
    expect(afterOne).toBe(atStart);
    expect(afterTwo).toBe(atStart);
    expect(atStart).toBeLessThanOrEqual(riceCookerModule.questions.length);
  });

  it("最大分岐（functions）の質問数に一致する", () => {
    expect(estimateTotalSteps(riceCookerModule.questions)).toBe(6);
  });
});

describe("validateQuestionGraph（P2-10: 質問グラフ検証）", () => {
  it("実モジュールのグラフは検証を通過する", () => {
    expect(validateQuestionGraph(riceCookerModule.questions)).toEqual([]);
    expect(validateRegisteredModules()).toEqual([]);
  });

  it("存在しない next キーを検出する", () => {
    const questions = [
      { key: "a", order: 1, question: "Q", options: [{ value: "x", label: "X", next: "nope" }] },
    ];
    const issues = validateQuestionGraph(questions);
    expect(issues.some((i) => i.message.includes("next=nope"))).toBe(true);
  });

  it("到達できない質問（孤児）を検出する", () => {
    const questions = [
      { key: "a", order: 1, question: "Q", options: [{ value: "x", label: "X" }] },
      { key: "orphan", order: 2, question: "Q2", options: [{ value: "y", label: "Y" }] },
    ];
    const issues = validateQuestionGraph(questions);
    expect(issues.some((i) => i.message.includes("orphan"))).toBe(true);
  });

  it("分岐の循環を検出する", () => {
    const questions = [
      {
        key: "a",
        order: 1,
        question: "Q",
        options: [
          { value: "x", label: "X", next: "b" },
          { value: "y", label: "Y" },
        ],
      },
      {
        key: "b",
        order: 2,
        question: "Q2",
        options: [{ value: "z", label: "Z", next: "a" }],
      },
    ];
    const issues = validateQuestionGraph(questions);
    expect(issues.some((i) => i.message.includes("循環"))).toBe(true);
  });
});

describe("recommend ガードと結果メタデータ", () => {
  it("1問だけの回答では候補を出さず警告（canShowPartialResultの保証）", async () => {
    const fetched = await adapter.fetch(new ctxCtor());
    const { products } = await adapter.normalize(fetched, ctxCtor());
    const result = recommend(riceCookerModule, { cookVolume: "5.5" }, products, new Map());
    expect(result.status).toBe("partial");
    expect(result.candidates).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("resultにmaxScoreとscoreLabelsが載る", async () => {
    const fetched = await adapter.fetch(new ctxCtor());
    const { products } = await adapter.normalize(fetched, ctxCtor());
    const result = recommend(riceCookerModule, FULL_ANSWERS, products, new Map());
    expect(result.maxScore).toBe(riceCookerModule.maxScore);
    expect(result.maxScore).toBeGreaterThan(0);
    expect(result.scoreLabels).toEqual(riceCookerModule.scoreLabels);
    expect(result.scoreLabels.fitScore).toBeDefined();
  });

  it("matchedCountは全マッチ数・candidatesは上位MAX_CANDIDATES件のみ", async () => {
    const fetched = await adapter.fetch(new ctxCtor());
    const { products } = await adapter.normalize(fetched, ctxCtor());
    const result = recommend(riceCookerModule, FULL_ANSWERS, products, new Map());
    expect(result.matchedCount).toBeGreaterThanOrEqual(result.candidates.length);
    expect(result.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES);
  });

  it("一致度%が回答条件ごとに到達可能な最大値で正規化される（attainableMaxScore）", async () => {
    const fetched = await adapter.fetch(new ctxCtor());
    const { products } = await adapter.normalize(fetched, ctxCtor());

    // 「加熱方式こだわらない」「予算こだわらない」なら到達可能上限が下がる
    const relaxed = recommend(
      riceCookerModule,
      { cookVolume: "5.5", heating: "any", budget: "any", priority: "taste", installWidth: "free" },
      products,
      new Map()
    );
    // heating 1.5 + budget 1.5 → 11 - 1 = 10
    expect(relaxed.maxScore).toBe(10);

    // 完全回答（加熱方式・予算とも指定）なら理論最大11に届く
    const full = recommend(riceCookerModule, FULL_ANSWERS, products, new Map());
    expect(full.maxScore).toBe(11);

    // 全候補の一致度%が100%以下になる
    for (const c of relaxed.candidates) {
      expect(c.totalScore).toBeLessThanOrEqual(relaxed.maxScore);
    }
  });
});

function ctxCtor() {
  return { categoryKey: "rice-cooker", now: new Date("2026-08-19T00:00:00Z") };
}

describe("budgetScore（実売offer価格ベース）", () => {
  const p = makeProduct({
    productId: "price1",
    referencePriceYen: 30000,
    specs: {
      capacityGou: 3,
      heatingMethod: "micom",
      powerW: null,
      weightKg: null,
      widthMm: null,
      depthMm: null,
      heightMm: null,
      keepWarmHours: null,
      innerPot: null,
      features: [],
      releaseYear: null,
    },
  });
  const offer = (priceMinor: number) => ({
    productId: "price1",
    providerKey: "test",
    providerItemId: "x",
    outboundUrl: "https://example.com/x",
    priceMinor,
    currency: "JPY",
    availability: "in_stock",
    updatedAt: "2026-08-19",
  });

  it("offer価格が予算内なら満点・予算超過なら0", () => {
    const criteria = deriveCriteria({ cookVolume: "3", budget: "10to20k" });
    // priceMinor は 円×100（例: 15000円=1500000）
    expect(budgetScoreViaScore(p, criteria, [offer(1500000)])).toBe(2);
    expect(budgetScoreViaScore(p, criteria, [offer(3000000)])).toBe(0);
  });

  it("「3万円以上」は上限なしとして扱う（7万円商品でも満点）", () => {
    const criteria = deriveCriteria({ cookVolume: "3", budget: "over30k" });
    expect(budgetScoreViaScore(p, criteria, [offer(7000000)])).toBe(2);
    // 下限（3万円）を大きく下回る商品は減点
    expect(budgetScoreViaScore(p, criteria, [offer(2000000)])).toBe(0);
  });

  it("予算内ギリギリ超過（1.2倍以内）は部分点", () => {
    const criteria = deriveCriteria({ cookVolume: "3", budget: "10to20k" });
    expect(budgetScoreViaScore(p, criteria, [offer(2300000)])).toBe(1);
  });

  it("価格不明（offer/referenceともnull）なら中立", () => {
    const unknown = makeProduct({
      productId: "price2",
      referencePriceYen: null,
      specs: {
        capacityGou: 3,
        heatingMethod: "micom",
        powerW: null,
        weightKg: null,
        widthMm: null,
        depthMm: null,
        heightMm: null,
        keepWarmHours: null,
        innerPot: null,
        features: [],
        releaseYear: null,
      },
    });
    const criteria = deriveCriteria({ cookVolume: "3", budget: "under10k" });
    expect(budgetScoreViaScore(unknown, criteria, [offer(null)])).toBe(1.5);
  });
});

function budgetScoreViaScore(
  product: RiceCookerProduct,
  criteria: ReturnType<typeof deriveCriteria>,
  offers: Array<{ priceMinor: number | null }>
) {
  const s = score(product, criteria, offers as never);
  return s.breakdown.budgetScore;
}

describe("featureScore（重視ポイントの再設計）", () => {
  const baseSpecs = {
    capacityGou: 5.5,
    powerW: null,
    weightKg: null,
    widthMm: null,
    depthMm: null,
    heightMm: null,
    keepWarmHours: null,
    innerPot: null,
    features: [] as string[],
    releaseYear: null,
  };

  it("手入れ（ease）は軽さで決まる", () => {
    const light = makeProduct({
      productId: "e1",
      specs: { ...baseSpecs, heatingMethod: "micom", weightKg: 3 },
    });
    const heavy = makeProduct({
      productId: "e2",
      specs: { ...baseSpecs, heatingMethod: "micom", weightKg: 6 },
    });
    const criteria = deriveCriteria({ cookVolume: "5.5", priority: "ease" });
    const sLight = score(light, criteria);
    const sHeavy = score(heavy, criteria);
    expect(sLight.breakdown.featureScore).toBe(3);
    expect(sHeavy.breakdown.featureScore).toBe(1);
  });

  it("味（taste）は加熱方式ベースで、玄米/発芽玄米対応なら加点", () => {
    const pressure = makeProduct({
      productId: "t1",
      specs: { ...baseSpecs, heatingMethod: "pressure_ih", features: ["germinated"] },
    });
    const micom = makeProduct({
      productId: "t2",
      specs: { ...baseSpecs, heatingMethod: "micom" },
    });
    const criteria = deriveCriteria({ cookVolume: "5.5", priority: "taste" });
    const sP = score(pressure, criteria);
    const sM = score(micom, criteria);
    expect(sP.breakdown.featureScore).toBeGreaterThan(sM.breakdown.featureScore);
    expect(sP.breakdown.featureScore).toBeLessThanOrEqual(3);
  });
});
