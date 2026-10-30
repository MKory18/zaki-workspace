import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/**
 * The owner's screenshots of «كل المساحات» (2026-10-30): the «إنت هون» badge sat on top of the delete button, the
 * name was cut to «…orkspace», and the words of a title ran together. Source-text tests, because the layout is a
 * class on a row: no render tells the three 44px buttons from a badge.
 */
describe("the space card (the owner's screenshot, 2026-10-30)", () => {
  const source = read("src/components/spaces-board.tsx");

  it("keeps room at the end of the title row for the three 44px buttons (menu, delete, grip)", () => {
    expect(source).toMatch(/className="flex items-center gap-2 pe-40"/);
    expect(source).not.toMatch(/gap-2 pe-24/);
  });

  it("puts the «إنت هون» badge beside «ادخل المساحة», not in the title row where the buttons sit", () => {
    const title = source.indexOf("pe-40");
    const badge = source.indexOf("data-here");
    const enter = source.indexOf('t("spaces.overview.enter")');
    expect(badge).toBeGreaterThan(enter);
    expect(badge).toBeGreaterThan(title);
  });
});

describe("titles keep a readable gap between words", () => {
  it("h1-h3 carry a word-spacing, because the display face's own space is only 0.13em", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(/h1,\s*h2,\s*h3 \{[^}]*word-spacing: 0\.18em/);
  });
});
