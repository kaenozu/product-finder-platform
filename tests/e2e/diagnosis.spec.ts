import { test, expect } from "@playwright/test";

test.describe("炊飯器選び診断", () => {
  test("開始画面から診断を開始し、1問目が表示される", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /あなたに合った炊飯器を/ })).toBeVisible();
    await page.getByRole("button", { name: "診断をはじめる" }).click();
    await expect(page.getByRole("heading", { name: "一回に炊くご飯の量は?" })).toBeVisible();
  });

  test("完全回答で結果画面に候補が表示される", async ({ page }) => {
    await page.goto("/");
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

  test("2問答えると質問画面のまま暫定候補が自動表示される", async ({ page }) => {
    await page.goto("/");
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
    await page.goto("/");
    await page.getByRole("button", { name: "診断をはじめる" }).click();

    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    await page.getByRole("button", { name: "特にこだわらない" }).click();
    await page.getByRole("button", { name: "こだわらない" }).click();
    await page.getByRole("button", { name: /便利な機能/ }).click();

    await expect(page.getByRole("heading", { name: /同時調理/ })).toBeVisible();
  });

  test("戻る操作で前の質問に戻れる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "診断をはじめる" }).click();

    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    await expect(page.getByRole("heading", { name: "加熱方式はこだわりますか?" })).toBeVisible();
    await page.getByRole("button", { name: "← 戻る" }).click();
    await expect(page.getByRole("heading", { name: "一回に炊くご飯の量は?" })).toBeVisible();
  });

  test("進捗の分母が固定され回答ごとに増えない（1/1→2/2→3/3 を防ぐ）", async ({ page }) => {
    await page.goto("/");
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
    await page.goto("/");
    await page.getByRole("button", { name: "診断をはじめる" }).click();
    await page.getByRole("button", { name: "5.5合（5人以上）" }).click();
    await expect(page.locator(".live-candidates")).toBeHidden();
    await expect(page.getByRole("heading", { name: "加熱方式はこだわりますか?" })).toBeVisible();
  });

  test("結果画面に一致度%と日本語ラベルのスコア内訳・単位付きスペックが表示される", async ({
    page,
  }) => {
    await page.goto("/");
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
});
