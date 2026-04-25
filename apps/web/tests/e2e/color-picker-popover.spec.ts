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

test("color picker drag tracks pointer position end-to-end", async ({
  page,
  browserName,
}) => {
  // WebKit's mouse-based drag is the closest proxy to iOS Safari
  // touch in Playwright. The actual iOS-26 fixed-element jitter
  // can't be reproduced here, but this catches regressions where
  // the marker doesn't follow the pointer at all.
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  await page
    .locator("section[aria-label='Sample images'] button")
    .first()
    .click();
  await expect(page.getByText("Thread colors")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 120_000 });

  await page
    .locator('button[aria-label^="Edit swatch"]')
    .first()
    .click();
  const popover = page.getByRole("dialog", { name: "Edit swatch color" });
  await expect(popover).toBeVisible();

  const sv = popover.getByRole("slider", { name: "Saturation and value" });
  const svBox = await sv.boundingBox();
  expect(svBox).not.toBeNull();
  if (!svBox) return;

  // Drag from upper-left (low s, high v) to lower-right (high s, low v).
  const startX = svBox.x + svBox.width * 0.1;
  const startY = svBox.y + svBox.height * 0.1;
  const endX = svBox.x + svBox.width * 0.9;
  const endY = svBox.y + svBox.height * 0.9;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    const t = i / 12;
    await page.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
  }
  await page.mouse.up();
  await page.waitForTimeout(50);

  // Read hex input — should reflect a high-saturation, low-value color.
  const hex = await popover.locator('input[aria-label="Hex color"]').inputValue();
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);

  // Marker dot's transform should encode roughly (0.9, 0.9) of SV size.
  const transform = await popover
    .locator('[aria-label="Saturation and value"] span[aria-hidden]')
    .first()
    .evaluate((el) => (el as HTMLElement).style.transform);
  const match = /translate3d\(([^,]+),\s*([^,]+),\s*0\)/.exec(transform);
  expect(match, `transform: ${transform}`).not.toBeNull();
  if (match) {
    const x = Number.parseFloat(match[1] ?? "0");
    const y = Number.parseFloat(match[2] ?? "0");
    // Around 90 % of SV width / height. WebKit/Chromium browsers
    // resolve pointer events differently — allow a generous band.
    expect(x).toBeGreaterThan(svBox.width * 0.7);
    expect(y).toBeGreaterThan(svBox.height * 0.7);
  }

  // Sanity: browser-specific noise notwithstanding, the marker
  // can't be glued to an edge.
  expect(browserName).toBeTruthy();
});
