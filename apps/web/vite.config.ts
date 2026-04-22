import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // Reject asset-looking URLs from the SPA fallback so a missing
        // hashed chunk 404s cleanly instead of being served index.html.
        // Without this, post-deploy a stale SW hands <!doctype html> back
        // to the JS parser and the browser throws
        // `SyntaxError: Unexpected token '<'`.
        navigateFallbackDenylist: [/\.(?:js|mjs|css|wasm|map|json)$/, /^\/assets\//],
        // Evict outdated precaches on every SW update so a newer deploy
        // can't read from a prior revision.
        cleanupOutdatedCaches: true,
        // Activate the updated SW immediately on next navigation — the
        // previous install-then-skipWaiting dance left stale clients
        // serving old chunks for a full refresh cycle.
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: "String",
        short_name: "String",
        description: "Turn a photo into a string-art construction pattern.",
        theme_color: "#FAF8F4",
        background_color: "#FAF8F4",
        display: "standalone",
        icons: [],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@solver": path.resolve(__dirname, "../../crates/solver/pkg"),
    },
  },
  // The production site sets COOP/COEP/CORP via apps/web/public/_headers
  // (see Cloudflare Pages). Replicating require-corp on the Vite dev server
  // breaks module workers, because Vite serves them from internal /@fs/
  // paths without matching CORP headers. The app doesn't use
  // SharedArrayBuffer, so cross-origin isolation is not required.
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
