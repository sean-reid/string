import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

async function primeAndNavigate(page: Page) {
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .first()
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Build" }).click();
  await expect(
    page.getByRole("heading", { name: "Construction guide" }),
  ).toBeVisible();
}

test.describe("construction guide", () => {
  test("renders materials + loom + sequence after a generate", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await primeAndNavigate(page);
    await expect(
      page.getByRole("region", { name: "Bill of materials" }),
    ).toBeVisible();
    await expect(page.getByText(/\d+\.\d m \(/)).toBeVisible();
    await expect(page.getByRole("img", { name: "Nail layout" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Thread sequence" }),
    ).toBeVisible();
    const items = page.getByRole("listitem");
    expect(await items.count()).toBeGreaterThan(10);
  });

  test("Space advances the current step", async ({ page }) => {
    test.setTimeout(90_000);
    await primeAndNavigate(page);
    const before = await page.getByText(/step 1 \//).textContent();
    expect(before).toBeTruthy();
    await page.keyboard.press("Space");
    await expect(page.getByText(/step 2 \//)).toBeVisible({ timeout: 2_000 });
  });

  test("checkbox progress persists across reloads", async ({ page }) => {
    test.setTimeout(120_000);
    await primeAndNavigate(page);
    const firstCheckbox = page
      .getByRole("listitem")
      .first()
      .getByRole("checkbox");
    await firstCheckbox.check();
    await expect(firstCheckbox).toBeChecked();
    await page.reload();
    await page.goto("/build");
    await expect(
      page.getByRole("heading", { name: "Construction guide" }),
    ).toBeVisible();
    const afterReload = page
      .getByRole("listitem")
      .first()
      .getByRole("checkbox");
    await expect(afterReload).toBeChecked({ timeout: 20_000 });
  });

  test("hands-free overlay opens and shows the current nail", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await primeAndNavigate(page);
    await page.getByRole("button", { name: "Hands-free mode" }).click();
    await expect(
      page.getByRole("dialog", { name: "Hands-free build mode" }),
    ).toBeVisible();
    // Pause so the auto-metronome doesn't fight the test.
    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByRole("button", { name: "Next nail" }).click();
    await expect(page.getByText(/step 2 \//).first()).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(
      page.getByRole("dialog", { name: "Hands-free build mode" }),
    ).toBeHidden();
  });
});
