import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("the runtime, in a real browser", () => {
  test("is cross-origin isolated", async ({ page }) => {
    await signIn(page);
    await page.goto("/#conformance");

    // Without this SharedArrayBuffer is gone, interrupt() degrades to killing the worker,
    // and an eight-year-old pays 5-12 seconds for every accidental infinite loop. It is
    // also completely silent when it breaks, which is why it is asserted rather than
    // assumed.
    await expect(page.getByTestId("cross-origin-isolated")).toHaveText("true");
  });

  test("passes the whole adapter contract", async ({ page }) => {
    await signIn(page);
    await page.goto("/#conformance");
    await page.getByRole("button", { name: "Run the suite" }).click();

    // Covers what no API-level test can reach: interrupting `while True: pass` without
    // losing the worker, every FailureKind classification, output truncation, and state
    // not leaking between runs. One of these — an infinite loop being reported as a
    // runtime error rather than a timeout — shipped to a real cluster.
    await expect(page.getByTestId("conformance-summary")).toHaveText("conformance:ok", {
      timeout: 150_000,
    });
  });
});
