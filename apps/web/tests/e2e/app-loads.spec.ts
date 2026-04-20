import { expect, test } from "@playwright/test";

test.describe("app shell", () => {
  test("home route renders with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");

    await expect(page).toHaveTitle("String");
    await expect(
      page.getByRole("link", { name: /String, back to the start/i }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: /empty loom/i })).toBeVisible();
    await expect(page.getByText("Drop an image")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("navigation to /build shows construction guide placeholder", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Build" }).click();
    await expect(page).toHaveURL(/\/build$/);
    await expect(
      page.getByRole("heading", { name: "Construction guide" }),
    ).toBeVisible();
  });

  test("unknown routes render the not-found page", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(
      page.getByRole("heading", { name: "Lost thread" }),
    ).toBeVisible();
  });
});
