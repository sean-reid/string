import { expect, test } from "@playwright/test";

const SAMPLES = [1, 2, 3, 4] as const;

for (const index of SAMPLES) {
  test(`render sample ${index}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto("/");
    await page
      .locator("section[aria-label='Sample images'] button")
      .nth(index - 1)
      .click();
    await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 120_000 });

    await page.screenshot({
      path: `test-results/showcase-${index}-rail.png`,
      fullPage: false,
    });

    const canvas = page.locator("canvas").first();
    await canvas.screenshot({
      path: `test-results/showcase-${index}-with-source.png`,
    });

    await page.getByLabel("Show source image underlay").click();
    await page.waitForTimeout(500);
    await canvas.screenshot({
      path: `test-results/showcase-${index}-lines-only.png`,
    });
  });
}
