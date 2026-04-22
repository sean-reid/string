import { expect, test } from "@playwright/test";

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

function dominantHue(rgb: [number, number, number]): string {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  if (max < 40) return "dark";
  const mid = (r + g + b) / 3;
  if (Math.abs(r - mid) < 15 && Math.abs(g - mid) < 15 && Math.abs(b - mid) < 15) {
    return "gray";
  }
  if (r >= g && r >= b) return g > b ? "warm" : "red";
  if (g >= r && g >= b) return "green";
  return "blue";
}

test("auto palette spans multiple hue directions on face photo", async ({ page }) => {
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
  const hues = new Set(hexes.map((h) => dominantHue(hexToRgb(h))));
  console.log("dominant hues:", [...hues]);

  await page.screenshot({
    path: "test-results/palette-gamut-rail.png",
    fullPage: false,
  });

  expect(hexes.length).toBe(6);
  expect(hues.size).toBeGreaterThanOrEqual(3);
});
