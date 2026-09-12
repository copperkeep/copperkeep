#!/usr/bin/env node
/**
 * "Every text token clears 4.5:1 on every ground it is specified for, in both themes"
 * (plan §13.2, §13.7). This runs in CI so a token edit cannot silently regress.
 *
 * The grounds below are the specification, not a convenience. Two of them are narrower
 * than "everywhere", and the measurements are why:
 *
 *   --fg-dim   is page-ground only. On a card in dark it measures 4.13:1, so dim
 *              metadata belongs on the page, not inside a card. Use --fg-muted there.
 *   accents    are text on the page and on cards. On --ink-800 in light they measure
 *              4.2-4.4:1, which is why that ground is checked at the 3:1 graphical bar:
 *              --ink-800 is the chart well and the editor, where accents are marks and
 *              limit lines, never body text.
 *
 * Widening a token's grounds means re-measuring, not relaxing the threshold.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "packages", "ui", "tokens.css"), "utf8");

function blockFor(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`no block for ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const vars = {};
  for (const line of css.slice(open + 1, close).split("\n")) {
    const match = line.match(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/);
    if (match) vars[`--${match[1]}`] = match[2];
  }
  return vars;
}

const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const THEMES = {
  light: blockFor(':root,\n[data-theme="light"]'),
  dark: blockFor('[data-theme="dark"]'),
};

const ACCENTS = ["--accent", "--accent-warn", "--accent-alt", "--accent-hot"];
const SERIES = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7"];

/** token -> the grounds it is specified on, and the bar it must clear there. */
const TEXT = [
  { tokens: ["--fg", "--fg-muted"], grounds: ["--ink-900", "--ink-800", "--ink-700"], min: 4.5 },
  { tokens: ["--fg-dim"], grounds: ["--ink-900"], min: 4.5 },
  { tokens: ACCENTS, grounds: ["--ink-900", "--ink-700"], min: 4.5 },
  { tokens: ACCENTS, grounds: ["--ink-800"], min: 3.0 },
  { tokens: SERIES, grounds: ["--ink-800"], min: 3.0 },
];

let failures = 0;
const report = (ok, label, value, min) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(48)} ${value.toFixed(2)}:1 (min ${min})`);
};

for (const [theme, tokens] of Object.entries(THEMES)) {
  for (const { tokens: group, grounds, min } of TEXT) {
    for (const ground of grounds) {
      for (const token of group) {
        const r = ratio(tokens[token], tokens[ground]);
        report(r >= min, `${theme} ${token} on ${ground}`, r, min);
      }
    }
  }
  // Each accent must also work as a fill carrying its on-accent text.
  for (const token of ACCENTS) {
    const r = ratio(tokens["--on-accent"], tokens[token]);
    report(r >= 4.5, `${theme} ${token} fill with --on-accent`, r, 4.5);
  }
}

if (failures > 0) {
  console.error(`\n${failures} contrast check(s) failed.`);
  process.exit(1);
}
console.log("\nAll contrast checks passed.");
