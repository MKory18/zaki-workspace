import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WP-UI1 · text below 12px is unreadable in Arabic on a small screen (review B item 9).
 *
 * The floor is `text-xs` (12px). Arbitrary pixel sizes below 12px (`text-[10px]`, `text-[11px]`)
 * are forbidden in src/components and src/app. The offenders other packages own are listed in the
 * WP-UI1 report; the ones THIS package owns are fixed here (the test fails while any remain in
 * the files WP-UI1 touched).
 */
const ROOT = path.resolve(__dirname, "..");
const BAD = /text-\[(?:9|10|11)(?:\.\d+)?px\]/g;

/** The directories the rule sweeps (WP-UI2 fixes its own shell files; both are under src). */
const DIRS = ["src/components", "src/app"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts|css)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

function readdir(dir: string): Array<import("node:fs").Dirent> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir, { withFileTypes: true });
}

describe("no font size below 12px in px units", () => {
  it("src/components and src/app never write text-[10px]/text-[11px]", () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        let m: RegExpExecArray | null;
        while ((m = BAD.exec(text))) offenders.push(`${path.relative(ROOT, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
