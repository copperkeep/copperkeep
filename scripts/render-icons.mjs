#!/usr/bin/env node
/**
 * Rasterise the brand icons in apps/web/public/icons/*.svg to the PNGs the manifest,
 * iOS and older browsers ask for. The SVGs are the source; rerun this after editing one
 * and commit both. Uses the e2e package's Playwright (Chromium), so run
 * `pnpm install` first.
 *
 *   node scripts/render-icons.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "apps", "web", "public");
const { chromium } = createRequire(join(root, "e2e", "package.json"))("@playwright/test");

/** [source svg, output png, size]. The 16 and 32 have their own pixel-fitted drawings. */
const TARGETS = [
  ["icons/favicon-16.svg", "icons/favicon-16.png", 16],
  ["favicon.svg", "icons/favicon-32.png", 32],
  // iOS applies its own mask, so the touch icon is the full-bleed square.
  ["icons/maskable.svg", "icons/apple-touch-icon.png", 180],
  ["icons/app-icon.svg", "icons/icon-192.png", 192],
  ["icons/app-icon.svg", "icons/icon-512.png", 512],
  ["icons/maskable.svg", "icons/maskable-512.png", 512],
];

// CHROMIUM_PATH points at a system Chromium when Playwright's own is not downloaded.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const [src, out, size] of TARGETS) {
  const svg = readFileSync(join(pub, src), "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  writeFileSync(join(pub, out), await page.locator("svg").screenshot({ omitBackground: true }));
  console.log(`${out} (${size}px)`);
}
await browser.close();
