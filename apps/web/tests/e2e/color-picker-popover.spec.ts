import { expect, test } from "./_fixtures";

test("color picker popover stays on-screen and is styled consistently", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  await page
    .locator("section[aria-label='Sample images'] button")
    .first()
    .click();
  await expect(page.getByText("Thread colors")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 120_000 });

  // Grow to 4 swatches so there's one near the right edge of the rail.
  const addBtn = page.getByRole("button", { name: "Add thread color" });
  for (let i = 0; i < 3; i += 1) {
    await addBtn.click();
    await page.waitForTimeout(200);
  }
  const swatches = page.locator('button[aria-label^="Edit swatch"]');
  await expect(swatches).toHaveCount(4);

  const initialScrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  await swatches.last().click();
  const popover = page.getByRole("dialog", { name: "Edit swatch color" });
  await expect(popover).toBeVisible();

  // No native color input anywhere — every control must be custom.
  await expect(popover.locator('input[type="color"]')).toHaveCount(0);
  await expect(
    popover.getByRole("slider", { name: "Saturation and value" }),
  ).toBeVisible();
  await expect(popover.getByRole("slider", { name: "Hue" })).toBeVisible();

  // Popover sits entirely inside the viewport.
  const box = await popover.boundingBox();
  expect(box).not.toBeNull();
  if (box && viewport) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }

  // And crucially: opening the popover must not widen the page.
  const openScrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(openScrollWidth).toBeLessThanOrEqual(initialScrollWidth);

  await popover.screenshot({
    path: "test-results/color-picker-popover.png",
  });
});
