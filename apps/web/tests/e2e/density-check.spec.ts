import { expect, test } from "@playwright/test";

async function runSample(page: import("@playwright/test").Page, arrowsToLeft: number, arrowsToRight: number) {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1400 });
  await page.goto("/");

  // Sample 4 — the one the user flagged.
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  const slider = page.getByRole("slider", { name: /palette size|swatches/i });
  await slider.focus();
  for (let i = 0; i < arrowsToLeft; i += 1) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < arrowsToRight; i += 1) await page.keyboard.press("ArrowRight");

  const generate = page
    .getByRole("button", { name: /generate again|^generate$/i })
    .first();
  await generate.click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 120_000 });

  // Hide the source underlay so the screenshot shows only threads.
  const showSource = page.getByLabel(/show source/i);
  if (await showSource.isChecked()) await showSource.uncheck();
}

test("sample 4 mono", async ({ page }) => {
  await runSample(page, 8, 0); // all-left then 0 right → palette size = 1 (mono)
  await page.screenshot({
    path: "test-results/density-sample4-mono.png",
    fullPage: false,
  });
});

test("sample 4 color 3", async ({ page }) => {
  await runSample(page, 8, 2); // all-left then +2 → palette size = 3
  await page.screenshot({
    path: "test-results/density-sample4-color3.png",
    fullPage: false,
  });
});

test("sample 4 color 6", async ({ page }) => {
  await runSample(page, 8, 5); // all-left then +5 → palette size = 6
  await page.screenshot({
    path: "test-results/density-sample4-color6.png",
    fullPage: false,
  });
});
