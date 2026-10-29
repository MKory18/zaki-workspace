/**
 * Writes the decoration stylesheet from its source of truth.
 *
 *   node scripts/build-decor-css.mjs            write src/components/theme/decor.css
 *   node scripts/build-decor-css.mjs --check    write nothing; exit 1 if the committed file differs
 *
 * The rules (what each theme draws in the four places it is allowed, and how loud) live in
 * `src/lib/themes/decor.ts`, a pure TypeScript module. The stylesheet is generated from it and COMMITTED, so
 * the page needs no build step for it and a reviewer reads the CSS that ships. `tests/themes-decor-css.test.ts`
 * runs this script with `--check`, so a hand edit of the CSS, or a change of the module without a rebuild, fails
 * the unit tests (and so the CI) with the command to run.
 *
 * It loads the module through `tsx` (already a dev dependency: the seed and the worker use it), so it runs on
 * any Node the project supports with no flags.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "..", "src", "components", "theme", "decor.css");
const check = process.argv.includes("--check");

const mod = await tsImport("../src/lib/themes/decor.ts", import.meta.url);
const render = mod.renderDecorCss ?? mod.default?.renderDecorCss;
if (typeof render !== "function") {
  console.error("build-decor-css: src/lib/themes/decor.ts does not export renderDecorCss()");
  process.exit(1);
}
const css = render();

/** LF only and one trailing newline: a Windows checkout and the Linux CI must compare equal. */
const normalize = (text) => text.replace(/\r\n/g, "\n").replace(/\s*$/, "\n");

if (check) {
  const current = existsSync(target) ? normalize(readFileSync(target, "utf8")) : null;
  if (current !== normalize(css)) {
    console.error(
      `build-decor-css: ${path.relative(process.cwd(), target)} is ${current === null ? "missing" : "out of date"}.\n` +
        "Run `node scripts/build-decor-css.mjs` and commit the result.",
    );
    process.exit(1);
  }
  console.log("build-decor-css: decor.css is up to date");
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  // UTF-8 without a BOM, LF line endings
  writeFileSync(target, normalize(css), { encoding: "utf8" });
  console.log(`build-decor-css: wrote ${path.relative(process.cwd(), target)}`);
}
