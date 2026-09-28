import { expect, test } from "@playwright/test";
import { expectLessonLoaded, signIn, typeCode, waitForRuntime } from "./helpers";

test.describe("the family view", () => {
  test("an admin adds a learner, and sees their progress, code and report", async ({
    page,
    browser,
  }) => {
    // Unique per run: the smoke stack is reused between retries.
    const username = `kid${Date.now().toString(36)}`;

    // 1 — the admin lands on Family, not a lesson, and adds a learner
    await signIn(page, "family");
    await expect(page.getByRole("heading", { name: /Who is learning/ })).toBeVisible();
    await page.getByRole("button", { name: "Add a learner" }).click();
    const form = page.locator("form.family__form").first();
    await form.getByLabel("Name they see").fill("Test Kid");
    await form.getByLabel("Username").fill(username);
    await form.getByLabel(/PIN/).fill("2468");
    await form.getByRole("button", { name: "Add learner" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`@${username}`) })).toBeVisible();

    // 2 — the learner signs in with their PIN on another device and does some work
    const kidContext = await browser.newContext();
    const kid = await kidContext.newPage();
    await signIn(kid, "lesson", { username, secret: "2468", method: "pin" });
    await expectLessonLoaded(kid);
    await kid.getByRole("button", { name: "Next", exact: true }).click();
    await kid.getByRole("button", { name: "Hello", exact: true }).click();
    await kid.getByRole("button", { name: "Next", exact: true }).click();
    await waitForRuntime(kid);
    await typeCode(kid, 'print("Hello")');
    await kid.getByRole("button", { name: "Check my answer" }).click();
    await expect(kid.locator(".test-row .pass")).toBeVisible();
    // Let the event batch reach the server before the adult looks.
    await kid.waitForTimeout(3000);
    await kidContext.close();

    // 3 — the admin sees the lesson in progress, with the code the learner wrote
    await page.reload();
    await page.getByRole("button", { name: new RegExp(`@${username}`) }).click();
    await page.getByRole("tab", { name: "Lessons" }).click();
    const lesson = page.locator(".family__lesson", { hasText: "Say hello" });
    await expect(lesson).toContainText(/of \d+ steps|done/);
    await lesson.click();
    await expect(page.locator(".family__steps .cm-content").first()).toContainText(
      'print("Hello")',
    );

    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.locator(".family__progress table.data")).toContainText("Say hello");

    await page.getByRole("tab", { name: "Report" }).click();
    await expect(page.getByRole("heading", { name: /Ask about/ })).toBeVisible();
    await expect(page.locator(".family__stats")).toBeVisible();

    // 4 — account changes: reading level, then removal behind a typed confirmation
    const panel = page.getByRole("region", { name: /Account: Test Kid/ });
    await panel.getByLabel("Reading level").selectOption("adult");
    await panel.getByRole("button", { name: "Save changes" }).click();
    await expect(panel.getByText("Saved.")).toBeVisible();

    await panel.getByRole("button", { name: /Remove this account/ }).click();
    const remove = panel.getByRole("button", { name: "Remove forever" });
    await expect(remove).toBeDisabled();
    await panel.getByLabel(new RegExp(`Type ${username}`)).fill(username);
    await remove.click();
    await expect(page.getByRole("button", { name: new RegExp(`@${username}`) })).toHaveCount(0);
  });
});
