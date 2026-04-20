import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

async function primePattern(page: Page) {
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .first()
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: "Build" }).click();
  await expect(
    page.getByRole("heading", { name: "Construction guide" }),
  ).toBeVisible();
}

async function advance(page: Page, steps: number) {
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("ArrowRight");
  }
  await page.waitForTimeout(250);
}

test.describe("build page visual sweep", () => {
  test("desktop initial state", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await primePattern(page);
    await page.screenshot({ path: "test-results/sweep-desktop-initial.png" });
  });

  test("desktop after 200 steps", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await primePattern(page);
    await advance(page, 200);
    await page.screenshot({ path: "test-results/sweep-desktop-200.png" });
  });

  test("desktop halfway", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await primePattern(page);
    await advance(page, 750);
    await page.screenshot({ path: "test-results/sweep-desktop-half.png" });
  });

  test("desktop with materials open", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await primePattern(page);
    await page.getByRole("button", { name: /^Materials/ }).click();
    await page.screenshot({ path: "test-results/sweep-desktop-materials.png" });
  });

  test("desktop with instructions open", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await primePattern(page);
    await page.getByRole("button", { name: /^How to build it/ }).click();
    await page.screenshot({
      path: "test-results/sweep-desktop-instructions.png",
    });
  });

  test("desktop with full sequence open", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await primePattern(page);
    await page.getByRole("button", { name: /^Sequence/ }).click();
    await page.getByRole("button", { name: /Show full list/ }).click();
    await page.screenshot({ path: "test-results/sweep-desktop-sequence.png" });
  });

  test("desktop hands-free overlay", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await primePattern(page);
    await advance(page, 50);
    await page.getByRole("button", { name: /Hands-free/ }).click();
    await expect(
      page.getByRole("dialog", { name: "Hands-free build mode" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/sweep-handsfree.png" });
  });

  test("tablet portrait", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 820, height: 1180 });
    await primePattern(page);
    await advance(page, 120);
    await page.screenshot({ path: "test-results/sweep-tablet.png" });
  });

  test("phone portrait", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 840 });
    await primePattern(page);
    await advance(page, 80);
    await page.screenshot({ path: "test-results/sweep-phone.png" });
  });
});
