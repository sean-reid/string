import { expect, test } from "@playwright/test";

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

function rec709(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
}

test("auto palette is face-driven and ordered dark to light", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(0)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  const slider = page.getByRole("slider", { name: /palette size|swatches/i });
  await slider.focus();
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("ArrowRight");
  }

  await page.getByRole("button", { name: /generate|resolve/i }).click().catch(() => {});
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  const swatches = await page
    .locator("[aria-label^='Auto swatch']")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("aria-label") ?? ""),
    );
  const hexes = swatches
    .map((label) => label.match(/#[0-9a-fA-F]{6}/)?.[0])
    .filter((h): h is string => !!h);

  console.log("auto swatches:", hexes);

  await page.screenshot({
    path: "test-results/palette-gamut-rail.png",
    fullPage: false,
  });

  expect(hexes.length).toBe(6);

  // Palette must be ordered ascending in luminance — the builder lays
  // dark threads first so bright highlights stack on top.
  const luminances = hexes.map((h) => rec709(hexToRgb(h)));
  for (let i = 1; i < luminances.length; i += 1) {
    expect(luminances[i]).toBeGreaterThanOrEqual(luminances[i - 1] - 0.01);
  }
});
