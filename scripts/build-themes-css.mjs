#!/usr/bin/env node
/**
 * Writes src/app/themes.css from the palettes (src/lib/themes/palettes.ts) — the one stylesheet
 * that carries every theme's tokens. Run it after changing a palette:
 *
 *   npx tsx scripts/build-themes-css.mjs           write the file
 *   npx tsx scripts/build-themes-css.mjs --check   write nothing; exit 1 if the file is stale
 *
 * `tsx` (a dev dependency) is needed because the palettes are TypeScript. The output is UTF-8
 * without a byte-order mark, LF line endings. tests/themes-css.test.ts fails (in `npm test` and CI)
 * while the committed file differs from what this script would write.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES_CSS_FILE, renderThemesCss } from "../src/lib/themes/css.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, THEMES_CSS_FILE);
const css = renderThemesCss();

let current = null;
try {
  current = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
} catch {
  current = null;
}

if (process.argv.includes("--check")) {
  if (current === css) {
    console.log(`${THEMES_CSS_FILE} is up to date.`);
    process.exit(0);
  }
  console.error(`${THEMES_CSS_FILE} is stale: run  npx tsx scripts/build-themes-css.mjs`);
  process.exit(1);
}

if (current === css) {
  console.log(`${THEMES_CSS_FILE} already up to date.`);
} else {
  writeFileSync(target, css, { encoding: "utf8" });
  console.log(`wrote ${THEMES_CSS_FILE} (${Buffer.byteLength(css)} bytes)`);
}
