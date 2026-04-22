import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Gecko coverage. Screenshot/regression specs stay chromium-only —
      // firefox only needs the interactive paths.
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: [
        "**/density-check.spec.ts",
        "**/showcase.spec.ts",
        "**/build-preview.spec.ts",
      ],
    },
    {
      // Screenshot/regression specs are chromium-only. No cross-browser
      // signal from re-solving them on WebKit/mobile-chrome, and the
      // solves dominate wall time on those runners.
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: [
        "**/density-check.spec.ts",
        "**/showcase.spec.ts",
        "**/build-preview.spec.ts",
      ],
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
      testIgnore: [
        "**/density-check.spec.ts",
        "**/showcase.spec.ts",
        "**/build-preview.spec.ts",
      ],
    },
  ],
  webServer: {
    command: `pnpm preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
