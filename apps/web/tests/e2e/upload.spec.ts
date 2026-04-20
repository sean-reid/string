import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(__dirname, "../fixtures/test-portrait.jpg");
const fixtureBase64 = readFileSync(fixture).toString("base64");

async function pushFixtureAs(page: Page, eventName: "drop" | "paste") {
  await page.evaluate(
    async ({ b64, kind }) => {
      const res = await fetch(`data:image/jpeg;base64,${b64}`);
      const blob = await res.blob();
      const file = new File([blob], "from-test.jpg", { type: "image/jpeg" });
      const dt = new DataTransfer();
      dt.items.add(file);
      if (kind === "drop") {
        const target = document.querySelector('label[for]');
        if (!target) throw new Error("drop target not found");
        target.dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
      } else {
        window.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
          }),
        );
      }
    },
    { b64: fixtureBase64, kind: eventName },
  );
}

test.describe("upload and decode", () => {
  test("picking a file ingests it and shows the ready state", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByText("Drop an image")).toBeVisible();

    const input = page.getByLabel("Choose an image to turn into string art");
    await input.setInputFiles(fixture);

    const stage = page.getByRole("img", { name: /loom preview/i });
    await expect(stage).toBeVisible({ timeout: 10_000 });
    await expect(stage).toHaveAttribute("data-state", "ready");

    const canvas = stage.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const size = await canvas.evaluate((el: HTMLCanvasElement) => ({
      w: el.width,
      h: el.height,
    }));
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBe(size.w);
  });

  test("drag-drop onto the dropzone ingests the file", async ({ page }) => {
    await page.goto("/");
    await pushFixtureAs(page, "drop");
    const stage = page.getByRole("img", { name: /loom preview/i });
    await expect(stage).toBeVisible({ timeout: 10_000 });
    await expect(stage).toHaveAttribute("data-state", "ready");
  });

  test("pasting an image from the clipboard ingests the file", async ({
    page,
  }) => {
    await page.goto("/");
    await pushFixtureAs(page, "paste");
    const stage = page.getByRole("img", { name: /loom preview/i });
    await expect(stage).toBeVisible({ timeout: 10_000 });
    await expect(stage).toHaveAttribute("data-state", "ready");
  });

  test("loading a sample ingests without a file picker", async ({ page }) => {
    await page.goto("/");
    await page
      .locator("section[aria-label='Sample images'] button")
      .first()
      .click();
    const stage = page.getByRole("img", { name: /loom preview/i });
    await expect(stage).toBeVisible({ timeout: 15_000 });
    await expect(stage).toHaveAttribute("data-state", "ready");
  });

  test("Esc cancels a running solver mid-generate", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page
      .locator("section[aria-label='Sample images'] button")
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible({
      timeout: 20_000,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByText(/stopped at/)).toBeVisible({ timeout: 10_000 });
  });

  test("solver renders a string-art pattern from a sample", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await page
      .locator("section[aria-label='Sample images'] button")
      .first()
      .click();
    const stage = page.getByRole("img", { name: /loom preview/i });
    await expect(stage).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 60_000 });

    // Capture the final canvas image-data hash-like fingerprint so the test
    // fails loudly on a blank canvas.
    const sampled = await stage.locator("canvas").nth(1).evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (!ctx) return 0;
      const data = ctx.getImageData(
        Math.floor(c.width * 0.4),
        Math.floor(c.height * 0.4),
        Math.floor(c.width * 0.2),
        Math.floor(c.height * 0.2),
      ).data;
      let acc = 0;
      for (let i = 0; i < data.length; i += 40) acc = (acc + data[i]!) & 0xffff;
      return acc;
    });
    expect(sampled).toBeGreaterThan(0);
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
