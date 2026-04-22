import { expect, test } from "./_fixtures";

const SAMPLES = [1, 2, 3, 4] as const;

for (const index of SAMPLES) {
  test(`render sample ${index}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto("/");
    await page
      .locator("section[aria-label='Sample images'] button")
      .nth(index - 1)
      .click();
    await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 30_000 });

    await page.screenshot({
      path: `test-results/showcase-${index}-rail.png`,
      fullPage: false,
    });

    const canvas = page.locator("canvas").first();
    await canvas.screenshot({
      path: `test-results/showcase-${index}-lines.png`,
    });
  });
}
