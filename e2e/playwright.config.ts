import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the layer nothing else reaches.
 *
 * Every user-visible bug this project has shipped lived here — a runtime disposed the
 * moment it was stored, a lesson that dead-ended, content 404ing through the real
 * ingress — and every one of them was invisible to the API-level smoke test because that
 * test never opened a browser.
 *
 * The base URL defaults to the Compose stack. `localhost` is a secure context even over
 * plain HTTP, so SharedArrayBuffer is available and `interrupt()` is genuinely under test
 * here rather than skipped.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  // Pyodide is ~10MB and compiles on first load; a cold run is slow and that is normal.
  timeout: 180_000,
  expect: { timeout: 45_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.COPPERKEEP_BASE_URL ?? "http://localhost:8443",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
