import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The enter / exit motion of dialogs, sheets and menus lives in one small CSS file. Radix keeps an
 * element mounted until its exit animation has finished, so every state is a real CSS animation, and
 * with `prefers-reduced-motion: reduce` there must be none (the element then appears and disappears at once).
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const css = read("src/components/ui/overlay-motion.css").replace(/\/\*[\s\S]*?\*\//g, "");

interface Block {
  prelude: string;
  body: string;
}

/** The top-level blocks of a stylesheet (rules and at-rules), found by matching braces. */
function topLevel(source: string): Block[] {
  const blocks: Block[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        blocks.push({ prelude: source.slice(preludeStart, bodyStart - 1).trim(), body: source.slice(bodyStart, i) });
        preludeStart = i + 1;
      }
    }
  }
  return blocks;
}

const blocks = topLevel(css);
const keyframes = blocks.filter((b) => b.prelude.startsWith("@keyframes"));
const media = blocks.filter((b) => b.prelude.startsWith("@media"));
const plain = blocks.filter((b) => !b.prelude.startsWith("@"));
const noPreference = media.filter((m) => /prefers-reduced-motion:\s*no-preference/.test(m.prelude));

describe("overlay motion stylesheet", () => {
  it("parses into keyframes, media blocks and plain rules (so the checks below are not vacuous)", () => {
    expect(keyframes.length).toBeGreaterThanOrEqual(8);
    expect(noPreference.length).toBeGreaterThanOrEqual(1);
    expect(plain.length).toBeGreaterThanOrEqual(1);
  });

  it("no animation or transition exists outside `prefers-reduced-motion: no-preference`", () => {
    for (const rule of plain) expect(rule.body, rule.prelude).not.toMatch(/\banimation|\btransition/);
    for (const m of media) {
      if (/\banimation|\btransition/.test(m.body)) expect(m.prelude, "an animation inside a media block that is not the no-preference one").toMatch(/prefers-reduced-motion:\s*no-preference/);
    }
  });

  it("every animation names keyframes that exist", () => {
    const defined = new Set(keyframes.map((k) => k.prelude.replace("@keyframes", "").trim()));
    const used = [...css.matchAll(/animation(?:-name)?\s*:\s*([a-z][\w-]*)/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThanOrEqual(8);
    for (const name of used) expect(defined.has(name), name).toBe(true);
  });

  it.each([".zk-fade", ".zk-pop", ".zk-sheet"])("%s has an entrance AND an exit (Radix waits for the exit before it removes the element)", (selector) => {
    const motion = noPreference.map((m) => m.body).join("\n");
    expect(motion).toContain(`${selector}[data-state="open"]`);
    expect(motion).toContain(`${selector}[data-state="closed"]`);
  });

  it("a sheet slides up from the bottom on phones and in from its side from Tailwind's md breakpoint (768px)", () => {
    expect(css).toContain("zk-sheet-up-in");
    expect(css).toContain("zk-sheet-up-out");
    expect(css).toContain("zk-sheet-side-in");
    expect(css).toContain("zk-sheet-side-out");
    expect(media.some((m) => /min-width:\s*768px/.test(m.prelude) && /zk-sheet-side-in/.test(m.body))).toBe(true);
  });

  it("the side slide follows the reading direction: it flips for rtl and for the start side", () => {
    expect(css).toMatch(/\[dir="rtl"\]\s+\.zk-sheet-end\s*\{\s*--zk-dir:\s*-1/);
    expect(css).toMatch(/\.zk-sheet-end\s*\{\s*--zk-dir:\s*1/);
    expect(css).toMatch(/\.zk-sheet-start\s*\{\s*--zk-dir:\s*-1/);
    expect(css).toMatch(/\[dir="rtl"\]\s+\.zk-sheet-start\s*\{\s*--zk-dir:\s*1/);
    expect(css).toMatch(/translateX\(calc\(100%\s*\*\s*var\(--zk-dir/);
  });

  it("a menu grows from its trigger (the transform origin Radix computes)", () => {
    expect(css).toContain("var(--radix-dropdown-menu-content-transform-origin)");
  });

  it("holds no colour: colours come from the theme tokens in the components", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  });

  it("every zk-* class the components use has a rule here", () => {
    const used = new Set<string>();
    for (const file of ["dialog", "sheet", "dropdown-menu"]) {
      for (const m of read(`src/components/ui/${file}.tsx`).matchAll(/(?<!data-)\bzk-[a-z-]+\b/g)) used.add(m[0]);
    }
    expect(used.size).toBeGreaterThanOrEqual(6);
    for (const name of used) expect(css, name).toContain(`.${name}`);
  });

  it("each component pulls the stylesheet in (a Next.js app router component may import CSS)", () => {
    for (const file of ["dialog", "sheet", "dropdown-menu"]) {
      expect(read(`src/components/ui/${file}.tsx`), file).toMatch(/import "\.\/overlay-motion\.css";/);
    }
  });
});
