import { expect, test } from "@playwright/test";

/** Does bumping line budget to 12k make the 3-color palette actually
 *  pop visible hue, or is the picker still limiting even at density? */
test("sample 4 color 3 at 12000 lines", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1400, height: 1400 });
  await page.goto("/");

  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 120_000 });

  // Grow palette to 3 + auto-pick.
  const addBtn = page.getByRole("button", { name: /add thread color/i });
  await addBtn.click();
  await addBtn.click();
  await page.getByRole("button", { name: /auto-pick/i }).click();

  // Crank line budget to near max via keyboard.
  const lines = page.getByRole("slider", { name: /^Lines$/ });
  await lines.focus();
  // Slide to max by pressing End, then a few back to settle at 12000ish.
  await page.keyboard.press("End");
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press("ArrowLeft");
  }

  await page.getByRole("button", { name: /generate again/i }).click();
  await expect(page.getByText(/done, 1[12],\d{3} lines/)).toBeVisible({
    timeout: 300_000,
  });

  await page.screenshot({
    path: "test-results/color3-high-density.png",
    fullPage: false,
  });
});
