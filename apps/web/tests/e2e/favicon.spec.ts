import { expect, test } from "@playwright/test";

test("favicon renders at icon sizes on light + dark surface", async ({
  page,
}) => {
  // Load an HTML document first (setContent needs one), then render
  // the icon in a grid on light + dark surfaces to visually confirm
  // legibility on either kind of browser-tab background.
  await page.goto("/");
  const url = new URL("/icon.svg", page.url()).toString();
  const html = `
    <!doctype html><html><head><style>
      body { margin: 0; font-family: sans-serif; }
      .row { display: flex; gap: 24px; padding: 24px; align-items: center; }
      .row.light { background: #f2efe8; }
      .row.dark { background: #111; color: #eee; }
      .swatch { display: flex; align-items: center; gap: 12px; }
      .swatch img { display: block; background: transparent; }
      .small { width: 16px; height: 16px; }
      .med { width: 32px; height: 32px; }
      .large { width: 96px; height: 96px; }
    </style></head><body>
      <div class="row light">
        <div class="swatch"><img src="${url}" class="small"/>16px</div>
        <div class="swatch"><img src="${url}" class="med"/>32px</div>
        <div class="swatch"><img src="${url}" class="large"/>96px</div>
      </div>
      <div class="row dark">
        <div class="swatch"><img src="${url}" class="small"/>16px</div>
        <div class="swatch"><img src="${url}" class="med"/>32px</div>
        <div class="swatch"><img src="${url}" class="large"/>96px</div>
      </div>
    </body></html>
  `;
  await page.setContent(html);
  await page.setViewportSize({ width: 600, height: 300 });
  await page.screenshot({
    path: "test-results/favicon-light-and-dark.png",
    fullPage: true,
  });

  // Sanity: the SVG loaded at all.
  const img = page.locator("img.large").first();
  await expect(img).toBeVisible();
});
