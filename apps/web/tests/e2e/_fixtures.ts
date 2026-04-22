/* eslint-disable react-hooks/rules-of-hooks -- Playwright's `use` fixture
   API is not a React hook; ESLint sees the name and misreports. */
import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, opts) => {
      if (typeof url === "string" && !url.includes("lines=")) {
        const sep = url.includes("?") ? "&" : "?";
        url = `${url}${sep}lines=120`;
      }
      return originalGoto(url, opts);
    };
    await use(page);
  },
});

export { expect };
