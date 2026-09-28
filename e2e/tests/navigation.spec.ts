import { expect, test } from "@playwright/test";
import { expectLessonLoaded, signIn } from "./helpers";

test.describe("finding your way around", () => {
  test("every course in the manifest is reachable from the lesson outline", async ({
    page,
  }) => {
    await signIn(page);
    await expectLessonLoaded(page);

    // Only the first course used to load, so everything after Python A was unreachable
    // and nothing noticed. Count against the manifest rather than a hard-coded number.
    const manifest = await (await page.request.get("/content/manifest.json")).json();
    const titles: string[] = manifest.courses.map((course: { title: string }) => course.title);

    await page.locator(".lesson-bar__current").click();
    const outline = page.getByRole("navigation", { name: "Lessons" });
    await expect(outline).toBeVisible();

    if (titles.length > 1) {
      const tabs = outline.getByRole("group", { name: "Course" }).getByRole("button");
      await expect(tabs).toHaveCount(titles.length);
      const last = titles.at(-1)!;
      await tabs.filter({ hasText: last }).click();
      await expect(tabs.filter({ hasText: last })).toHaveAttribute("aria-pressed", "true");
      await expect(outline.locator(".outline__lesson").first()).toBeVisible();
    }

    await page.keyboard.press("Escape");
    await expect(outline).toBeHidden();
  });

  test("the lesson you pick is where you come back to", async ({ page }) => {
    await signIn(page);
    await expectLessonLoaded(page);

    await page.locator(".lesson-bar__current").click();
    // Any open lesson other than the current one will do. On a brand-new account only the
    // first lesson is open; lesson.spec runs first (one worker, in order) and finishing it
    // masters print-output, which opens the rest of the first module.
    const target = page
      .locator(".outline__lesson:not([aria-disabled='true']):not([aria-current='true'])")
      .first();
    await expect(
      target,
      "no second lesson is open — did lesson.spec finish the first lesson?",
    ).toBeVisible({ timeout: 10_000 });
    const title = (await target.innerText()).trim();
    await target.click();
    await expect(page.locator(".lesson-bar__title")).toContainText(title);

    await page.reload();
    await expect(page.locator(".lesson-bar__title")).toContainText(title);
  });

  test("Easier letters switches the prose to a face that has actually loaded", async ({
    page,
  }) => {
    await signIn(page);
    await expectLessonLoaded(page);

    const toggle = page.getByRole("button", { name: "Easier letters" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-font", "dyslexia");

    // The toggle used to be a no-op: it named Atkinson Hyperlegible, which was never
    // shipped, so the browser silently fell back to the same system face.
    // fonts.check() answers true for a family with no @font-face at all, so ask for a
    // face that exists and finished loading.
    const loaded = await page.evaluate(async () => {
      await document.fonts.load('16px "Atkinson Hyperlegible"');
      return [...document.fonts].some(
        (face) =>
          face.family.replace(/"/g, "") === "Atkinson Hyperlegible" && face.status === "loaded",
      );
    });
    expect(loaded).toBe(true);
  });
});
