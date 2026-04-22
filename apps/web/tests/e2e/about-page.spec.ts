import { expect, test } from "@playwright/test";

test("about page renders the history + petros credit", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1400 });
  await page.goto("/about");

  await expect(page.getByRole("heading", { name: /^About$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /petros vrellis/i })).toBeVisible();
  await expect(page.getByText(/A new way to knit/i).first()).toBeVisible();
  await expect(page.getByText(/2016/).first()).toBeVisible();

  await page.screenshot({
    path: "test-results/about-page.png",
    fullPage: true,
  });
});
