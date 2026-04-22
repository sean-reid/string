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

/** Sum of pairwise squared distances between palette entries in RGB
 *  space, normalized to [0,1]. A value near zero means every slot is
 *  the same hue; a value close to 1 indicates a gamut-spanning mix. */
function paletteSpread(hexes: string[]): number {
  const rgbs = hexes.map(hexToRgb);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < rgbs.length; i += 1) {
    for (let j = i + 1; j < rgbs.length; j += 1) {
      const dr = (rgbs[i][0] - rgbs[j][0]) / 255;
      const dg = (rgbs[i][1] - rgbs[j][1]) / 255;
      const db = (rgbs[i][2] - rgbs[j][2]) / 255;
      sum += dr * dr + dg * dg + db * db;
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

test("auto palette spans the image gamut and layers dark to light", async ({
  page,
}) => {
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
  const spread = paletteSpread(hexes);
  console.log("palette spread:", spread);

  await page.screenshot({
    path: "test-results/palette-gamut-rail.png",
    fullPage: false,
  });

  expect(hexes.length).toBe(6);

  // Palette must meaningfully span the RGB cube, not collapse to a
  // single hue. An empirical floor of 0.15 rejects all-salmon-variations
  // outputs while staying below typical real-photo values (~0.25-0.4).
  expect(spread).toBeGreaterThan(0.15);

  // And it must be ordered ascending in luminance — dark threads go
  // down first so bright highlights stack on top.
  const luminances = hexes.map((h) => rec709(hexToRgb(h)));
  for (let i = 1; i < luminances.length; i += 1) {
    expect(luminances[i]).toBeGreaterThanOrEqual(luminances[i - 1] - 0.01);
  }
});
