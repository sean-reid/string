import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(__dirname, "../fixtures/test-portrait.jpg");

test.describe("upload and decode", () => {
  test("picking a file ingests it and shows the ready state", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByText("Drop an image")).toBeVisible();

    const input = page.getByLabel("Choose an image to turn into string art");
    await input.setInputFiles(fixture);

    await expect(page.getByText("Image ready")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/\d+ px preview/)).toBeVisible();
  });

  test("rejects non-image files with a friendly message", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("Choose an image to turn into string art");
    await input.setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await expect(page.getByRole("alert")).toContainText("not an image");
  });
});
