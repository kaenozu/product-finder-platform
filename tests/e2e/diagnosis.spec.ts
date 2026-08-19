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

  test("2問だけ答えて途中プレビューができる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "診断をはじめる" }).click();

    await page.getByRole("button", { name: "3合（2〜3人分）" }).click();
    await page.getByRole("button", { name: /^IH炊飯器/ }).click();
    await page.getByRole("button", { name: "この条件で候補を見る" }).click();

    await expect(page.getByText("診断結果・途中")).toBeVisible();
    await expect(page.locator(".product-card").first()).toBeVisible();
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
});
