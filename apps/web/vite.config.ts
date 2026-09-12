import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The dev server sets the same COOP/COEP headers the ingress does, and proxies every
 * path to the same origin. Developing against a second origin would make
 * crossOriginIsolated false locally and true in production — the one difference you do
 * not want to discover in Phase 5.
 */
const CROSS_ORIGIN_ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const target = process.env.COPPERKEEP_API_PROXY ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    headers: CROSS_ORIGIN_ISOLATION,
    proxy: {
      "/v1": { target, changeOrigin: false },
      "/healthz": { target },
      "/content": { target: process.env.COPPERKEEP_CONTENT_PROXY ?? "http://localhost:8080" },
      "/audio": { target: process.env.COPPERKEEP_AUDIO_PROXY ?? "http://localhost:8081" },
      "/runtimes": { target: process.env.COPPERKEEP_RUNTIMES_PROXY ?? "http://localhost:8082" },
    },
  },
  preview: { headers: CROSS_ORIGIN_ISOLATION },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
});
