import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderDecorCss } from "@/lib/themes/decor";

/**
 * «نجمة وطريق»: every font and every picture of the look is served by this site. next/font fetches
 * IBM Plex and Lalezar once at BUILD time and serves them from here, Reem Kufi is in public/fonts, the
 * star field is drawn in code — so a visitor's browser never asks Google (or anybody) for the look.
 * GLM's attempt (#3) is the reason this is written down: a stylesheet link to fonts.googleapis.com or an
 * `url(https://…)` in the CSS would quietly undo it.
 */

const ROOT = path.resolve(__dirname, "..");

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else if (/\.(css|ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const EXTERNAL_FONT = /fonts\.(?:googleapis|gstatic)\.com/;
const EXTERNAL_URL = /url\(\s*["']?(?:https?:)?\/\//;

describe("the look loads nothing from another site", () => {
  it("no source file names Google's font servers", () => {
    const hits = filesUnder(path.join(ROOT, "src")).filter((f) => EXTERNAL_FONT.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("no stylesheet (hand-written or generated) has an url() that points off the site", () => {
    const sheets = filesUnder(path.join(ROOT, "src")).filter((f) => f.endsWith(".css"));
    expect(sheets.length).toBeGreaterThan(2);
    for (const f of sheets) expect(readFileSync(f, "utf8"), path.relative(ROOT, f)).not.toMatch(EXTERNAL_URL);
    expect(renderDecorCss()).not.toMatch(EXTERNAL_URL);
  });

  it("and the check can fail", () => {
    expect('@import url("https://fonts.googleapis.com/css2?family=Lalezar");').toMatch(EXTERNAL_FONT);
    expect("background: url(//cdn.example.com/a.webp)").toMatch(EXTERNAL_URL);
    expect("mask: url(/brand/decor/a.webp)").not.toMatch(EXTERNAL_URL);
  });
});
