import { expect, test } from "@playwright/test";
import { expectLessonLoaded, signIn, typeCode, waitForRuntime } from "./helpers";

test.describe("a lesson, end to end", () => {
  test("runs code, grades it, and leads somewhere when finished", async ({ page }) => {
    await signIn(page);
    await expectLessonLoaded(page);

    // 1 — narrative
    await page.getByRole("button", { name: "Next" }).click();

    // 2 — predict. An understanding probe, so it is unaided by design.
    await page.getByRole("button", { name: "Hello", exact: true }).click();
    await page.getByRole("button", { name: "Next" }).click();

    // 3 — free code
    await waitForRuntime(page);
    await typeCode(page, 'print("Hello")');
    await page.getByRole("button", { name: "Run", exact: true }).click();

    // THE regression that shipped: the runtime was disposed the instant it was stored,
    // so Run was enabled and did nothing at all. Asserting the output is the only way to
    // tell a working button from a dead one.
    await expect(page.locator(".out")).toContainText("Hello");

    await page.getByRole("button", { name: "Check my answer" }).click();
    await expect(page.locator(".test-row .pass")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    // 4 — the transfer item, and the last step of the lesson
    await typeCode(page, 'print("red")\nprint("green")\nprint("blue")');
    await page.getByRole("button", { name: "Check my answer" }).click();

    // Finishing used to leave a disabled button and nowhere to go. A completed lesson is
    // a destination.
    await expect(page.getByText("Lesson complete")).toBeVisible();
    await expect(page.getByRole("button", { name: /Start |See your skills/ })).toBeVisible();
  });

  test("a wrong answer is graded as wrong, not silently accepted", async ({ page }) => {
    await signIn(page);
    await expectLessonLoaded(page);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Hello", exact: true }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await waitForRuntime(page);
    await typeCode(page, 'print("Goodbye")');
    await page.getByRole("button", { name: "Check my answer" }).click();

    await expect(page.locator(".test-row .fail")).toBeVisible();
    // Passing tests proves nothing if failing ones also "pass".
    await expect(page.getByText("Lesson complete")).toBeHidden();
  });

  test("a syntax error is explained, not a traceback", async ({ page }) => {
    await signIn(page);
    await expectLessonLoaded(page);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Hello", exact: true }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await waitForRuntime(page);
    await typeCode(page, 'print("Hello"');
    await page.getByRole("button", { name: "Run", exact: true }).click();

    const output = page.locator(".out");
    await expect(output).toContainText(/typo|could not read/i);
    await expect(output).not.toContainText("Traceback");
  });
});
