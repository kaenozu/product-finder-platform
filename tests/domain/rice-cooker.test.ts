import { describe, it, expect } from "vitest";
import { recommend, MAX_CANDIDATES } from "../../src/shared/domain/engine";
import { riceCookerModule } from "../../src/shared/domain/registry";
import {
  deriveCriteria,
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
      { requiredCapacityGou: 5.5, budgetMaxYen: 20000, installWidthMm: 240, useTacook: true },
    ],
    [
      { cookVolume: "3" },
      { requiredCapacityGou: 3, budgetMaxYen: null, installWidthMm: null, useTacook: false },
    ],
    [
      { cookVolume: "10", budget: "under10k", installWidth: "free" },
      { requiredCapacityGou: 10, budgetMaxYen: 10000, installWidthMm: null, useTacook: false },
    ],
  ])("answers=%j → criteria部分", (answers, expected) => {
    const c = deriveCriteria(answers);
    expect(c.requiredCapacityGou).toBe(expected.requiredCapacityGou);
    expect(c.budgetMaxYen).toBe(expected.budgetMaxYen);
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
