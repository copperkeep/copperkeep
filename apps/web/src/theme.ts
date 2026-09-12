import type { ReadingTier } from "@copperkeep/contracts";

export type Theme = "auto" | "light" | "dark";

/**
 * Learner surfaces follow prefers-color-scheme and fall back to light — bright
 * classrooms, projectors, and long prose for young readers. Adult surfaces default to
 * dark, because those are the house-style reports.
 *
 * Never decided by role alone: a parent reading a report on a sunny porch flips to
 * light, and the toggle is always there (§13.1).
 */
export function resolveTheme(theme: Theme, role: "adult" | "learner"): "light" | "dark" {
  if (theme !== "auto") return theme;
  if (role === "adult") return "dark";
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme, role: "adult" | "learner"): void {
  document.documentElement.dataset.theme = resolveTheme(theme, role);
}

export function applyTier(tier: ReadingTier): void {
  document.documentElement.dataset.tier = tier;
}

export function applyDyslexiaFont(enabled: boolean): void {
  if (enabled) {
    document.documentElement.dataset.font = "dyslexia";
  } else {
    delete document.documentElement.dataset.font;
  }
}
