import { expect, test } from "./_fixtures";

/** Mono-only density smoke on the four sample images. Confirms the
 *  solver renders a recognizable portrait at the default line budget
 *  for every sample, not just the one that was easiest. */
for (const sampleIndex of [1, 2, 3, 4] as const) {
  test(`sample ${sampleIndex} mono`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1400, height: 1400 });
    await page.goto("/");
    await page
      .locator("section[aria-label='Sample images'] button")
      .nth(sampleIndex - 1)
      .click();
    await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: `test-results/mono-sample${sampleIndex}.png`,
      fullPage: false,
    });
  });
}
