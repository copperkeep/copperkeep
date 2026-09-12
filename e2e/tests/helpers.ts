import { expect, type Page } from "@playwright/test";

export const ORG = process.env.COPPERKEEP_ORG ?? "home";
export const USERNAME = process.env.COPPERKEEP_USERNAME ?? "admin";
export const PASSWORD = process.env.COPPERKEEP_PASSWORD ?? "smoke-admin-password";
/** "password" for an adult, "pin" for a learner — the credential a child actually uses. */
export const METHOD = process.env.COPPERKEEP_METHOD ?? "password";

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");

  const username = page.locator("#username");
  const shell = page.getByRole("heading", { name: "Copperkeep", level: 1 });

  // isVisible() answers immediately rather than waiting, so checking it straight after a
  // goto just asks whether React has rendered yet — which it has not. Wait for whichever
  // entry state the app lands in: the sign-in form, or the shell if the cookie is live.
  await expect(username.or(shell).first()).toBeVisible();

  if (await username.isVisible()) {
    await page.locator("#org").fill(ORG);
    await username.fill(USERNAME);
    // The form defaults to a PIN, which is the right default for a child.
    if (METHOD === "password") {
      await page.getByRole("button", { name: "I'm a grown-up" }).click();
    }
    await page.locator("#secret").fill(PASSWORD);
    await page.getByRole("button", { name: "Go" }).click();
  }

  await expect(shell).toBeVisible();
}

/** Replaces the editor's contents. CodeMirror needs real keystrokes, not a fill(). */
export async function typeCode(page: Page, code: string): Promise<void> {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.type(code);
}

/** Waits for Pyodide. The button enables only once a runtime is in hand. */
export async function waitForRuntime(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled({
    timeout: 150_000,
  });
}
