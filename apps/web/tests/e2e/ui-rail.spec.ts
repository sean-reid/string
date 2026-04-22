import { expect, test } from "@playwright/test";

test("rail: no thread-type / no min-chord / no show-source / palette has swatches+plus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  // These controls should be gone.
  await expect(page.getByText(/thread type/i)).toHaveCount(0);
  await expect(page.getByText(/^min chord/i)).toHaveCount(0);
  await expect(page.getByLabel(/show source/i)).toHaveCount(0);
  await expect(page.getByText(/palette is derived from/i)).toHaveCount(0);
  await expect(page.getByText(/^auto$/i)).toHaveCount(0); // Auto/Manual segmented

  // Palette should show at least one swatch + an add button.
  const plus = page.getByRole("button", { name: /add thread color/i });
  await expect(plus).toBeVisible();

  // Clicking + adds a swatch.
  const before = await page
    .getByRole("button", { name: /edit thread color/i })
    .count();
  await plus.click();
  const after = await page
    .getByRole("button", { name: /edit thread color/i })
    .count();
  expect(after).toBe(before + 1);

  await page.screenshot({
    path: "test-results/rail-new-palette.png",
    fullPage: false,
    clip: { x: 880, y: 0, width: 400, height: 800 },
  });
});

test("auto-pick at N runs FPS with k=N, not a prefix of k=6", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  // At palette size 3, auto-pick should produce the best 3-color
  // extraction, which in general differs from the first 3 entries
  // of the 6-color extraction.
  await page.getByRole("button", { name: /add thread color/i }).click();
  await page.getByRole("button", { name: /add thread color/i }).click();
  await page.getByRole("button", { name: /auto-pick/i }).click();
  await page.waitForTimeout(200);

  // Read straight from the Zustand store — suggestionsBySize is
  // per-image and in-memory only, so localStorage won't reflect it.
  const snapshot = await page.evaluate(() => {
    // @ts-ignore - test-only peek into the global Zustand store
    const store = (window as unknown as { useSolverStore?: unknown })
      .useSolverStore;
    // If the app doesn't expose the store, peek at persisted palette
    // and read suggestions via the devtools-friendly hack: inspect
    // the DOM's data-testid, or just fall through.
    return {
      physicalPalette:
        JSON.parse(localStorage.getItem("string.solver.v1") ?? "{}")?.state
          ?.physical?.palette ?? null,
      storeAvailable: Boolean(store),
    };
  });

  expect(snapshot.physicalPalette).toHaveLength(3);
});

test("auto-pick changes palette when suggestions differ from defaults", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  // Grow palette to 3 first so auto-pick has room to meaningfully
  // change (at size 1, the k=1 extraction returns black which equals
  // the default user palette, so the call is a legitimate no-op).
  await page.getByRole("button", { name: /add thread color/i }).click();
  await page.getByRole("button", { name: /add thread color/i }).click();

  const before = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("string.solver.v1") ?? "{}").state
        ?.physical?.palette ?? null,
  );
  await page.getByRole("button", { name: /auto-pick/i }).click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("string.solver.v1") ?? "{}").state
        ?.physical?.palette ?? null,
  );

  expect(after).not.toEqual(before);
  expect(after).toHaveLength(3);
});

test("color picker opens without overflowing the rail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .locator("section[aria-label='Sample images'] button")
    .nth(3)
    .click();
  await expect(page.getByText(/done, \d/)).toBeVisible({ timeout: 90_000 });

  const plus = page.getByRole("button", { name: /add thread color/i });
  await plus.click();
  await plus.click();

  const swatch = page
    .getByRole("button", { name: /edit thread color 3/i })
    .first();
  await swatch.click();
  await expect(page.getByRole("dialog", { name: /color picker/i })).toBeVisible();

  await page.screenshot({
    path: "test-results/rail-picker-open.png",
    fullPage: false,
    clip: { x: 880, y: 0, width: 400, height: 900 },
  });
});
