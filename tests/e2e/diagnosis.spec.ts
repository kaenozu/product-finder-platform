import { test, expect } from "@playwright/test";

test.describe("pitarikoポータル（URL分離）", () => {
  test("トップ（/）はブランドポータルを表示し、診断カテゴリへリンクする", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /pitariko/ })).toBeVisible();
    await expect(page.getByText("診断を選ぶ")).toBeVisible();
    await page.getByRole("link", { name: /炊飯器選び診断/ }).click();
    await expect(page.getByRole("heading", { name: /あなたに合った炊飯器を/ })).toBeVisible();
  });

  test("トップで診断の負担・利用条件・結果イメージ・判定根拠を確認できる", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("サービスの利用条件").getByText("無料・登録不要")).toBeVisible();
    await expect(page.getByLabel("サービスの利用条件").getByText(/最大\d+問/)).toBeVisible();
    const resultPreview = page.getByRole("region", { name: "診断結果の表示例" });
    await expect(resultPreview).toBeVisible();
    await expect(resultPreview.getByText("第一候補")).toBeVisible();
    await expect(resultPreview.getByText("合う理由", { exact: true })).toBeVisible();
    await expect(resultPreview.getByText("妥協点", { exact: true })).toBeVisible();
    await expect(resultPreview.getByText("他候補との違い", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "判定の根拠" })).toBeVisible();
    await expect(page.locator(".hero-cta")).toBeVisible();
  });

  test("トップの主要CTAとカテゴリ選択はキーボードで操作できる", async ({ page }) => {
    await page.goto("/");
    const cta = page.locator(".hero-cta");
    await cta.focus();
    await expect(cta).toBeFocused();
    await cta.press("Enter");
    await expect(page.getByRole("heading", { name: /あなたに合った炊飯器を/ })).toBeVisible();
  });
});

test.describe("炊飯器選び診断", () => {
  test("開始画面から診断を開始し、1問目が表示される", async ({ page }) => {
    await page.goto("/rice-cooker");
    await expect(page.getByRole("heading", { name: /あなたに合った炊飯器を/ })).toBeVisible();
    await page.getByRole("button", { name: "診断をはじめる" }).click();
    await expect(page.getByRole("heading", { name: "一回に炊くご飯の量は?" })).toBeVisible();
  });

  test("完全回答で結果画面に候補が表示される", async ({ page }) => {
    await page.goto("/rice-cooker");
    await page.getByRole("button", { name: "診断をはじめる" }).click();

    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    await page.getByRole("button", { name: "特にこだわらない" }).click();
    await page.getByRole("button", { name: "こだわらない" }).click();
    await page.getByRole("button", { name: "炊き上がりの味" }).click();
    await page.getByRole("button", { name: "制限なし" }).click();

    await expect(page.getByRole("heading", { name: "あなたに合う炊飯器" })).toBeVisible();
    await expect(page.locator(".product-card").first()).toBeVisible();
    await expect(page.getByText("診断結果・確定")).toBeVisible();
  });

  test("結果から回答変更へ戻ると最後の質問が未回答の正しい番号で表示される", async ({ page }) => {
    await page.goto("/rice-cooker");
    await page.getByRole("button", { name: "診断をはじめる" }).click();
    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    await page.getByRole("button", { name: "特にこだわらない" }).click();
    await page.getByRole("button", { name: "こだわらない" }).click();
    await page.getByRole("button", { name: "炊き上がりの味" }).click();
    await page.getByRole("button", { name: "制限なし" }).click();

    await page.getByRole("button", { name: "← 回答を変更する" }).click();

    const backHeading = page.getByRole("heading", { name: "置き場所の幅の制限は?" });
    await expect(backHeading).toBeVisible();
    await expect(backHeading).toBeFocused();
    await expect(page.getByText("質問 5", { exact: true })).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
  });

  test("2問答えると質問画面のまま暫定候補が自動表示される", async ({ page }) => {
    await page.goto("/rice-cooker");
    await page.getByRole("button", { name: "診断をはじめる" }).click();

    await page.getByRole("button", { name: "3合（2〜3人分）" }).click();
    const previewResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/diagnosis/evaluate") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: /^IH炊飯器/ }).click();
    expect((await previewResponse).ok()).toBe(true);

    await expect(page.getByRole("heading", { name: "予算の目安は?" })).toBeVisible();
    const liveCandidates = page.locator(".live-candidates");
    await expect(liveCandidates.getByText("回答途中の候補")).toBeVisible();
    await expect(liveCandidates.locator(".live-candidate").first()).toBeVisible();
    await expect(liveCandidates.getByText(/一致度 \d+%/).first()).toBeVisible();

    await liveCandidates.getByRole("button", { name: "詳しく見る" }).click();
    await expect(page.getByText("診断結果・途中")).toBeVisible();
  });

  test("機能重視を選ぶと同時調理の質問が現れる", async ({ page }) => {
    await page.goto("/rice-cooker");
    await page.getByRole("button", { name: "診断をはじめる" }).click();

    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    await page.getByRole("button", { name: "特にこだわらない" }).click();
    await page.getByRole("button", { name: "こだわらない" }).click();
    await page.getByRole("button", { name: /便利な機能/ }).click();

    await expect(page.getByRole("heading", { name: /同時調理/ })).toBeVisible();
  });

  test("戻る操作で前の質問に戻れる", async ({ page }) => {
    await page.goto("/rice-cooker");
    await page.getByRole("button", { name: "診断をはじめる" }).click();

    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    await expect(page.getByRole("heading", { name: "加熱方式はこだわりますか?" })).toBeVisible();
    await page.getByRole("button", { name: "← 戻る" }).click();
    await expect(page.getByRole("heading", { name: "一回に炊くご飯の量は?" })).toBeVisible();
  });

  test("進捗の分母が固定され回答ごとに増えない（1/1→2/2→3/3 を防ぐ）", async ({ page }) => {
    await page.goto("/rice-cooker");
    await page.getByRole("button", { name: "診断をはじめる" }).click();

    const firstText = await page.getByRole("progressbar").getAttribute("aria-valuetext");
    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    const secondText = await page.getByRole("progressbar").getAttribute("aria-valuetext");
    await page.getByRole("button", { name: "特にこだわらない" }).click();
    const thirdText = await page.getByRole("progressbar").getAttribute("aria-valuetext");

    expect(firstText).toContain("全6問程度");
    expect(secondText).toContain("全6問程度");
    expect(thirdText).toContain("全6問程度");
  });

  test("1問だけでは暫定候補を表示しない", async ({ page }) => {
    await page.goto("/rice-cooker");
    await page.getByRole("button", { name: "診断をはじめる" }).click();
    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    await expect(page.locator(".live-candidates")).toBeHidden();
    await expect(page.getByRole("heading", { name: "加熱方式はこだわりますか?" })).toBeVisible();
  });

  test("結果画面に一致度%と日本語ラベルのスコア内訳・単位付きスペックが表示される", async ({
    page,
  }) => {
    await page.goto("/rice-cooker");
    await page.getByRole("button", { name: "診断をはじめる" }).click();

    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    await page.getByRole("button", { name: "特にこだわらない" }).click();
    await page.getByRole("button", { name: "こだわらない" }).click();
    await page.getByRole("button", { name: "炊き上がりの味" }).click();
    await page.getByRole("button", { name: "制限なし" }).click();

    await expect(page.getByRole("heading", { name: "あなたに合う炊飯器" })).toBeVisible();
    await expect(page.getByText(/一致度 \d+%/).first()).toBeVisible();
    await expect(page.locator(".spec-chips span").first()).toContainText(/合/);
    await page.locator(".product-card").first().getByRole("button", { name: "詳しく見る" }).click();
    await expect(page.getByText("スコア内訳")).toBeVisible();
    await expect(page.getByText("容量との相性")).toBeVisible();
    await expect(page.getByText("加熱方式")).toBeVisible();
    await expect(page.getByText("予算")).toBeVisible();
  });

  test("結果画面に商品画像・購入CTA・データ更新日・アフィリエイト開示が表示される", async ({
    page,
  }) => {
    await page.goto("/rice-cooker");
    await page.getByRole("button", { name: "診断をはじめる" }).click();

    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    await page.getByRole("button", { name: "特にこだわらない" }).click();
    await page.getByRole("button", { name: "こだわらない" }).click();
    await page.getByRole("button", { name: "炊き上がりの味" }).click();
    await page.getByRole("button", { name: "制限なし" }).click();

    const card = page.locator(".product-card").first();
    await expect(page.getByRole("heading", { name: "あなたに合う炊飯器" })).toBeVisible();
    await expect(card.locator(".product-image img").first()).toBeVisible();
    await expect(page.getByText("本サイトはアフィリエイト広告を利用しています")).toBeVisible();
  });
});
