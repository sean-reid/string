import { expect, test } from "@playwright/test";

test("rail: no thread-type / no min-chord / no show-source / palette has swatches+plus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  // These controls should be gone.
  await expect(page.getByText(/thread type/i)).toHaveCount(0);
  await expect(page.getByText(/^min chord/i)).toHaveCount(0);
  await expect(page.getByLabel(/show source/i)).toHaveCount(0);
  await expect(page.getByText(/palette is derived from/i)).toHaveCount(0);
  await expect(page.getByText(/^auto$/i)).toHaveCount(0); // Auto/Manual segmented

  // Palette should show at least one swatch + an add button.
  const plus = page.getByRole("button", { name: /add thread color/i });
  await expect(plus).toBeVisible();

  // Clicking + adds a swatch.
  const before = await page
    .getByRole("button", { name: /edit thread color/i })
    .count();
  await plus.click();
  const after = await page
    .getByRole("button", { name: /edit thread color/i })
    .count();
  expect(after).toBe(before + 1);

  await page.screenshot({
    path: "test-results/rail-new-palette.png",
    fullPage: false,
    clip: { x: 880, y: 0, width: 400, height: 800 },
  });
});

test("auto-pick overwrites palette with extracted suggestions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  // Inspect what the solver store actually has as suggestions.
  const storePalette = await page.evaluate(() => {
    const storage = localStorage.getItem("string.solver.v1");
    if (!storage) return null;
    const parsed = JSON.parse(storage);
    return parsed.state?.palette ?? null;
  });
  console.log("store.palette after solve:", storePalette);

  const physicalBefore = await page.evaluate(() => {
    const storage = localStorage.getItem("string.solver.v1");
    if (!storage) return null;
    const parsed = JSON.parse(storage);
    return parsed.state?.physical?.palette ?? null;
  });
  console.log("physical.palette BEFORE auto-pick:", physicalBefore);

  await page.getByRole("button", { name: /auto-pick/i }).click();
  await page.waitForTimeout(500);

  const physicalAfter = await page.evaluate(() => {
    const storage = localStorage.getItem("string.solver.v1");
    if (!storage) return null;
    const parsed = JSON.parse(storage);
    return parsed.state?.physical?.palette ?? null;
  });
  console.log("physical.palette AFTER auto-pick:", physicalAfter);

  expect(physicalAfter).not.toEqual(physicalBefore);
});

test("color picker opens without overflowing the rail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  const plus = page.getByRole("button", { name: /add thread color/i });
  await plus.click();
  await plus.click();

  const swatch = page
    .getByRole("button", { name: /edit thread color 3/i })
    .first();
  await swatch.click();
  await expect(page.getByRole("dialog", { name: /color picker/i })).toBeVisible();

  await page.screenshot({
    path: "test-results/rail-picker-open.png",
    fullPage: false,
    clip: { x: 880, y: 0, width: 400, height: 900 },
  });
});
