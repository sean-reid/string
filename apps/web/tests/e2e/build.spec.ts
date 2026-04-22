import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

async function primeAndNavigate(page: Page) {
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .first()
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Build" }).click();
  await expect(
    page.getByRole("heading", { name: "Build guide" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /Loom, step/ })).toBeVisible();
}

test.describe("build guide", () => {
  test("loads with loom, step controls, and tabs", async ({ page }) => {
    test.setTimeout(90_000);
    await primeAndNavigate(page);
    await expect(page.getByText("Current nail")).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /^Materials/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /^How to build it/ }),
    ).toBeVisible();
    await expect(page.getByRole("term").filter({ hasText: "board" }).first())
      .toBeVisible();
  });

  test("ArrowRight advances, ArrowLeft rewinds", async ({ page }) => {
    test.setTimeout(90_000);
    await primeAndNavigate(page);
    const loom = page.getByRole("img", { name: /Loom, step/ });
    await expect(loom).toHaveAttribute("aria-label", /step 1 of/);
    await page.keyboard.press("ArrowRight");
    await expect(loom).toHaveAttribute("aria-label", /step 2 of/);
    await page.keyboard.press("ArrowRight");
    await expect(loom).toHaveAttribute("aria-label", /step 3 of/);
    await page.keyboard.press("ArrowLeft");
    await expect(loom).toHaveAttribute("aria-label", /step 2 of/);
  });

  test("Space toggles auto-play", async ({ page }) => {
    test.setTimeout(90_000);
    await primeAndNavigate(page);
    await expect(
      page.getByRole("button", { name: "Start auto-advance" }),
    ).toBeVisible();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "Pause auto-advance" }),
    ).toBeVisible();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "Start auto-advance" }),
    ).toBeVisible();
  });

  test("Read aloud toggles aria-pressed", async ({ page }) => {
    test.setTimeout(90_000);
    await primeAndNavigate(page);
    const btn = page.getByRole("button", { name: /Read aloud|Reading/ });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  test("progress persists across reload", async ({ page }) => {
    test.setTimeout(120_000);
    await primeAndNavigate(page);
    const loom = page.getByRole("img", { name: /Loom, step/ });
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(loom).toHaveAttribute("aria-label", /step 6 of/);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Build guide" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("img", { name: /Loom, step/ }),
    ).toHaveAttribute("aria-label", /step 6 of/, { timeout: 20_000 });
  });

  test("Instructions tab reveals step-by-step sections", async ({ page }) => {
    test.setTimeout(90_000);
    await primeAndNavigate(page);
    await page.getByRole("tab", { name: /^How to build it/ }).click();
    await expect(
      page.getByRole("heading", { name: "Prepare the board" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Work the sequence" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Alternate the wrap side" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /If something goes sideways/ }),
    ).toBeVisible();
  });

  test("Header shows thread color indicator", async ({ page }) => {
    test.setTimeout(90_000);
    await primeAndNavigate(page);
    const swatch = page.getByLabel("Thread color");
    await expect(swatch).toBeVisible();
    await expect(swatch).toContainText(/black thread/i);
  });

  test("Printables buttons render under Materials tab", async ({ page }) => {
    test.setTimeout(90_000);
    await primeAndNavigate(page);
    const template = page.getByRole("button", { name: /Nail template/ });
    const booklet = page.getByRole("button", { name: /Sequence booklet/ });
    await expect(template).toBeVisible();
    await expect(template).toBeEnabled();
    await expect(booklet).toBeVisible();
    await expect(booklet).toBeEnabled();
  });
});
