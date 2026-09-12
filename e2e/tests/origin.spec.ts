import { expect, test } from "@playwright/test";

/**
 * Five services, one origin. These are plain HTTP checks rather than UI ones because the
 * failure they guard against is a proxy or ingress quietly rewriting a path — which is
 * exactly what shipped: the chart's own Ingress 404'd on /content and /runtimes because
 * every test environment happened to strip prefixes.
 */
test.describe("the single origin", () => {
  test("serves every service under its own prefix", async ({ request }) => {
    for (const path of [
      "/config.json",
      "/content/manifest.json",
      "/content/steps.json",
      "/runtimes/pyodide/v0.26.4/pyodide.mjs",
    ]) {
      const response = await request.get(path);
      expect(response.status(), `${path} should be served`).toBe(200);
    }
  });

  test("routes /v1 to the API with its prefix intact", async ({ request }) => {
    // 401 rather than 404: the route reaches the API, and the API still sees /v1/me.
    const response = await request.get("/v1/me");
    expect(response.status()).toBe(401);
  });

  test("sets the cross-origin isolation headers on the document", async ({ request }) => {
    const headers = (await request.get("/")).headers();
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["cross-origin-embedder-policy"]).toBe("require-corp");
  });
});
