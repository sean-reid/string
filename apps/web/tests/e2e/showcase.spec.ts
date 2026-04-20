import { expect, test } from "@playwright/test";

const SAMPLES = ["Smile", "Portrait", "Headshot", "Lioness"];

for (const label of SAMPLES) {
  test(`render sample: ${label}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto("/");
    await page
      .getByRole("button", { name: new RegExp(`Use sample: ${label}`, "i") })
      .click();
    await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 120_000 });

    await page.screenshot({
      path: `test-results/showcase-${label.toLowerCase()}-rail.png`,
      fullPage: false,
    });

    const canvas = page.locator("canvas").first();
    await canvas.screenshot({
      path: `test-results/showcase-${label.toLowerCase()}-with-source.png`,
    });

    await page.getByLabel("Show source image underlay").click();
    await page.waitForTimeout(500);
    await canvas.screenshot({
      path: `test-results/showcase-${label.toLowerCase()}-lines-only.png`,
    });
  });
}
