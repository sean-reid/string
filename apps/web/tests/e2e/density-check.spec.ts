import { expect, test } from "@playwright/test";

async function loadSample(page: import("@playwright/test").Page) {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1400 });
  await page.goto("/");

  // Sample 4 — the one the user flagged.
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });
}

async function setPaletteSize(
  page: import("@playwright/test").Page,
  target: number,
) {
  // The new palette UX starts at size 1 and grows one swatch per "+"
  // click. Read current count, click + to reach target.
  const addBtn = page.getByRole("button", { name: /add thread color/i });
  const countLocator = page.locator("text=/\\d+ of 6/");
  // parse "N of 6"
  const text = (await countLocator.textContent()) ?? "1 of 6";
  const match = /(\d+) of/.exec(text);
  const current = match && match[1] ? parseInt(match[1], 10) : 1;
  for (let i = current; i < target; i += 1) await addBtn.click();

  if (target > 1) {
    // Replace the user's palette with the image-derived best-N picks.
    await page.getByRole("button", { name: /auto-pick/i }).click();
    await page.waitForTimeout(200);
  }

  // Kick a fresh solve with the new palette.
  await page.getByRole("button", { name: /generate again/i }).click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 120_000 });
}

test("sample 4 mono", async ({ page }) => {
  await loadSample(page);
  // Mono = palette size 1 (the default). No + clicks, no auto-pick.
  await page.screenshot({
    path: "test-results/density-sample4-mono.png",
    fullPage: false,
  });
});

test("sample 4 color 3", async ({ page }) => {
  await loadSample(page);
  await setPaletteSize(page, 3);
  await page.screenshot({
    path: "test-results/density-sample4-color3.png",
    fullPage: false,
  });
});

test("sample 4 color 6", async ({ page }) => {
  await loadSample(page);
  await setPaletteSize(page, 6);
  await page.screenshot({
    path: "test-results/density-sample4-color6.png",
    fullPage: false,
  });
});
