import { expect, test } from "./_fixtures";

test("rail: mono-only controls, no palette UI, no board selector, no show-source", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  // All these controls were removed in the mono-only cleanup.
  await expect(page.getByText(/thread type/i)).toHaveCount(0);
  await expect(page.getByText(/^min chord/i)).toHaveCount(0);
  await expect(page.getByLabel(/show source/i)).toHaveCount(0);
  await expect(page.getByText(/palette is derived from/i)).toHaveCount(0);
  await expect(page.getByText(/^colors$/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /auto-pick/i })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /add thread color/i }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /color picker/i })).toHaveCount(
    0,
  );

  // The remaining controls should be nails + lines sliders.
  await expect(page.getByRole("slider", { name: /nails/i })).toBeVisible();
  await expect(page.getByRole("slider", { name: /^lines$/i })).toBeVisible();

  await page.screenshot({
    path: "test-results/rail-mono-only.png",
    fullPage: false,
    clip: { x: 880, y: 0, width: 400, height: 800 },
  });
});
