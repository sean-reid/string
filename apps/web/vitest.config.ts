import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@solver": path.resolve(__dirname, "../../crates/solver/pkg"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["tests/**", "**/*.config.{ts,js}"],
    },
  },
});
