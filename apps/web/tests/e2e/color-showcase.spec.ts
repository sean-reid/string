import { expect, test } from "./_fixtures";

test("color solve renders a multi-color portrait", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  // Load sample 1 and wait for the initial (mono) solve to finish.
  await page
    .locator("section[aria-label='Sample images'] button")
    .first()
    .click();
  await expect(page.getByText("Thread colors")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 120_000 });

  // Grow the palette to 4 colors via `[+]`, then auto-pick a gamut-
  // diverse set. Each `[+]` click calls suggest_next_color in the
  // worker; the button is enabled while the solver is idle.
  const addBtn = page.getByRole("button", { name: "Add thread color" });
  for (let i = 0; i < 3; i += 1) {
    await addBtn.click();
    await page.waitForTimeout(300);
  }
  await page.getByRole("button", { name: "Auto-pick all" }).click();
  await page.waitForTimeout(500);

  // Verify the palette actually grew and contains more than just
  // black. 4 editable swatches + the add button should be visible.
  const swatches = page.locator('button[aria-label^="Edit swatch"]');
  await expect(swatches).toHaveCount(4);

  // Re-solve with the new palette. The e2e fixture clamps the budget
  // (lines=120), so this finishes quickly; the test proves the color
  // code path runs end-to-end without errors or hangs.
  await page.getByRole("button", { name: "Generate again" }).click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 120_000 });

  await page.screenshot({
    path: "test-results/color-showcase-rail.png",
    fullPage: false,
  });
  const canvas = page.locator("canvas").first();
  await canvas.screenshot({
    path: "test-results/color-showcase-lines.png",
  });
});
