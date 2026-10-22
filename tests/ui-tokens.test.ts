import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";
import config from "../tailwind.config";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";
import { samples } from "./ui-samples";

/**
 * Structural tests over every building block of this batch (dialog, sheet, menu, spinner, skeleton,
 * toast, install hint, loading screen): the pixels are checked in a browser by the coordinator, but the
 * rules that make the pixels right are checked here: theme tokens only, logical CSS only, every class is
 * one Tailwind really generates, nothing prints a raw dictionary key, every control has an Arabic name.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const SOURCES = [
  "src/components/ui/dialog.tsx",
  "src/components/ui/sheet.tsx",
  "src/components/ui/dropdown-menu.tsx",
  "src/components/ui/modal.tsx",
  "src/components/ui/spinner.tsx",
  "src/components/ui/skeleton.tsx",
  "src/components/ui/toast.tsx",
  "src/components/pwa/install-hint.tsx",
  "src/app/(app)/loading.tsx",
  "src/components/ui/overlay-motion.css",
  "src/lib/tips.ts",
  "src/lib/pwa-install.ts",
];

const all = samples();
const markups = Object.entries(all);
const everything = markups.map(([, m]) => m).join("\n");
const tokens = classTokens(everything);

describe("the samples are real (so the checks below are not vacuous)", () => {
  it("every building block rendered something, and together they use plenty of classes", () => {
    for (const [name, markup] of markups) expect(markup.length, name).toBeGreaterThan(50);
    expect(tokens.length).toBeGreaterThan(120);
  });
});

describe("colours come only from the theme tokens", () => {
  it("no Tailwind palette colour, black or white in any class", () => {
    expect(tokens.filter((c) => PALETTE_COLOUR.test(c))).toEqual([]);
  });

  it("the dimming layer behind a dialog or a sheet is the theme's scrim at 60% (a dark veil in every theme), and nothing else dims", () => {
    expect(all["dialogWithOverlay"]).toContain("bg-scrim/60");
    expect(all["modal"]).toContain("bg-scrim/60");
    for (const [name, markup] of markups) {
      for (const tag of markup.matchAll(/<[a-z][^>]*\bclass="[^"]*bg-scrim[^"]*"[^>]*>/g)) {
        expect(tag[0], `${name}: bg-scrim on something that is not the overlay`).toContain("zk-fade");
      }
    }
  });

  it("no inline colour in the markup", () => {
    expect(everything).not.toMatch(/style="[^"]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/);
  });

  it("no hard-coded colour in the source files (hex, rgb(), hsl())", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("no Tailwind palette class, black or white in the source files either", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (PALETTE_COLOUR.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("the interface is right-to-left: logical CSS only", () => {
  it("no left/right/ml/mr/pl/pr/inset-x utility in any class", () => {
    const offenders = tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string));
    expect(offenders).toEqual([]);
  });

  it("no physical direction in the motion stylesheet except where the slide itself needs a sign (translateX)", () => {
    const css = read("src/components/ui/overlay-motion.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/\b(?:margin|padding|border)-(?:left|right)\b|(?:^|[\s{;])(?:left|right)\s*:/);
  });
});

describe("words and names", () => {
  it("nothing prints a raw dictionary key (a missing translation prints the key itself)", () => {
    for (const [name, markup] of markups) {
      expect(textOf(markup), name).not.toMatch(/\b(?:ui|pwa|tips|common)\.[a-z_]+/);
    }
  });

  it("no English word on screen: every visible text and accessible name is Arabic", () => {
    for (const [name, markup] of markups) {
      const names = [...markup.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1] as string);
      for (const label of [...names, textOf(markup)]) {
        expect(label.replace(/Zaki Workspace|Zaki/g, ""), name).not.toMatch(/[A-Za-z]{2,}/);
      }
    }
  });

  it("every button has an Arabic accessible name (text, aria-label or aria-labelledby)", () => {
    let checked = 0;
    for (const [name, markup] of markups) {
      for (const [whole, inner] of markup.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)) {
        const named =
          /[؀-ۿ]/.test(textOf(inner as string)) || /aria-label="[^"]*[؀-ۿ]/.test(whole) || /aria-labelledby=/.test(whole);
        expect(named, `${name}: ${whole.slice(0, 120)}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  it("no control is left at the 32 to 40px sizes: icon buttons and menu items are thumb-sized", () => {
    const small = /(^|\s)(h|size)-(8|9|10)(\s|$)/;
    for (const [name, markup] of markups) {
      for (const tag of markup.matchAll(/<(button|input|select|textarea)\b[^>]*>/g)) {
        if (/aria-label="الاسم"|aria-label="حقل"/.test(tag[0])) continue; // a bare field in a sample form
        const cls = /class="([^"]*)"/.exec(tag[0])?.[1] ?? "";
        expect(small.test(cls), `${name}: ${tag[0].slice(0, 140)}`).toBe(false);
      }
    }
  });
});

describe("Tailwind really generates every class (a typo would silently do nothing)", () => {
  let css = "";

  beforeAll(async () => {
    const result = await postcss([tailwindcss({ ...config, content: [{ raw: tokens.join(" "), extension: "html" }] })]).process("@tailwind utilities;", {
      from: undefined,
    });
    css = result.css;
  });

  // how Tailwind writes a class as a selector: a backslash before each odd character, and a comma as the hex escape `\2c `
  const escapeSelector = (token: string) => token.replace(/[^a-zA-Z0-9_-]/g, (c) => (c === "," ? "\\2c " : `\\${c}`));
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasRule = (token: string) => new RegExp(`\\.${escapeRegExp(escapeSelector(token))}(?![\\w\\\\-])`).test(css);

  /** Classes that are not Tailwind's: the motion stylesheet's zk-* and the icon library's own markers. */
  const custom = (token: string) => /^zk-/.test(token) || /^lucide(-|$)/.test(token);

  /** Classes whose colour is one of the semantic tokens THEME-CORE adds to tailwind.config.ts (`lucide-info` is an icon's marker, not a colour). */
  const semantic = (token: string) =>
    !custom(token) && /-(?:ok|warn|danger|info|scrim|accent-2|cat-[1-6])(?:-fg)?(?:\/\d+)?$/.test(token.split(":").pop() as string);

  it("every class that is neither a theme-token class nor ours has a rule", () => {
    const missing = tokens.filter((t) => !custom(t) && !semantic(t) && !hasRule(t));
    expect(missing).toEqual([]);
  });

  it("every theme-token class (text-ok, text-danger, bg-danger/10 ...) has a rule: tailwind.config.ts defines those colours", () => {
    const wanted = tokens.filter((t) => semantic(t));
    expect(wanted).toEqual(expect.arrayContaining(["text-ok", "text-danger", "data-[highlighted]:bg-danger/10"]));
    const missing = wanted.filter((t) => !hasRule(t));
    expect(missing, "the colour tokens ok / warn / danger / info must be in the tailwind colours").toEqual([]);
  });

  it("the sheet's md layer rounds only the corners that face the page: md:rounded-none comes before md:rounded-s-2xl / md:rounded-e-2xl", () => {
    const at = (token: string) => css.search(new RegExp(`\\.${escapeRegExp(escapeSelector(token))}(?![\\w\\\\-])`));
    expect(at("md:rounded-none")).toBeGreaterThan(-1);
    expect(at("md:rounded-s-2xl")).toBeGreaterThan(at("md:rounded-none"));
    expect(at("md:rounded-e-2xl")).toBeGreaterThan(at("md:rounded-none"));
  });

  it("reduced motion wins over the normal animation: the motion-reduce rules come after animate-spin / animate-pulse", () => {
    const at = (token: string) => css.search(new RegExp(`\\.${escapeRegExp(escapeSelector(token))}(?![\\w\\\\-])`));
    expect(at("motion-reduce:animate-pulse")).toBeGreaterThan(at("animate-spin"));
    expect(at("motion-reduce:animate-none")).toBeGreaterThan(at("animate-pulse"));
  });

  it("the md variants really are Tailwind's 768px breakpoint (the motion stylesheet switches at the same width)", () => {
    expect(css).toMatch(/@media \(min-width: 768px\)/);
  });
});
