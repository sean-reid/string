import { expect, test } from "@playwright/test";

async function primePattern(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .first()
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 60_000 });
}

test.describe("exports", () => {
  test("png 1x downloads a valid image blob", async ({ page }) => {
    test.setTimeout(90_000);
    await primePattern(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /PNG 1x/ }).click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/\.png$/);
  });

  test("svg export contains the expected line count", async ({ page }) => {
    test.setTimeout(90_000);
    await primePattern(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^SVG/ }).click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    const body = await fs.readFile(path!, "utf-8");
    expect(body).toContain("<svg");
    expect(body).toContain("<line");
    expect(body).toMatch(/<\/svg>\s*$/);
  });

  test("csv export has a header and sequence rows", async ({ page }) => {
    test.setTimeout(90_000);
    await primePattern(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^CSV/ }).click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    const body = await fs.readFile(path!, "utf-8");
    expect(body).toContain("step,nail");
    expect(body).toContain("# nails,");
    expect(body.trim().split("\n").length).toBeGreaterThan(100);
  });

  test("copy puts the nail sequence on the clipboard", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await primePattern(page);
    await page.getByRole("button", { name: /^Copy/ }).click();
    await expect(page.getByText(/copied to clipboard/)).toBeVisible({
      timeout: 5_000,
    });
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text.split(",").length).toBeGreaterThan(100);
  });
});
