import { expect, test } from "./_fixtures";

test("rail: core controls plus palette picker, deprecated knobs gone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  // These controls really were removed (physical-build solver cleanup):
  // users don't pick thread type, tune a min-chord slider, or toggle a
  // source preview anymore.
  await expect(page.getByText(/thread type/i)).toHaveCount(0);
  await expect(page.getByText(/^min chord/i)).toHaveCount(0);
  await expect(page.getByLabel(/show source/i)).toHaveCount(0);
  // The old "palette is derived from" note shipped under an auto/manual
  // toggle that's since been replaced by the swatch picker.
  await expect(page.getByText(/palette is derived from/i)).toHaveCount(0);

  // Core solver controls are still present.
  await expect(page.getByRole("slider", { name: /nails/i })).toBeVisible();
  await expect(page.getByRole("slider", { name: /^lines$/i })).toBeVisible();

  // Palette picker is now part of the rail (mono starts at one swatch).
  await expect(page.getByText(/thread colors/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /add thread color/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /auto-pick all/i }),
  ).toBeVisible();

  await page.screenshot({
    path: "test-results/rail-color-mode.png",
    fullPage: false,
    clip: { x: 880, y: 0, width: 400, height: 800 },
  });
});
