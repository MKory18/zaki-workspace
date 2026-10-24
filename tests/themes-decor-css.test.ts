import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { THEME_KEYS, type ThemeKey } from "@/lib/themes/registry";
import {
  CAPS,
  COMPOSED,
  DECOR_KINDS,
  MOTION,
  PATTERN,
  PHOTOGRAPHIC,
  SCRIM,
  WASH,
  allDecorFiles,
  decorFilesOf,
  patternTileSvg,
  patternTileUrl,
  renderDecorCss,
} from "@/lib/themes/decor";
import { DECOR_CSS_FILE, ROOT, normalizeText, parseCss, read, valueOf, type CssRule } from "./themes-decor-helpers";

/**
 * THE DECORATION STYLESHEET, READ AS RULES.
 *
 * `src/components/theme/decor.css` is generated from `src/lib/themes/decor.ts` by
 * `scripts/build-decor-css.mjs`; these claims are about what that stylesheet DOES:
 *   - it is exactly what the generator makes (no hand edits, no stale copy);
 *   - it names no colour of its own — every colour is a variable of the active theme;
 *   - `off` draws nothing, `light` is still, `full` moves slowly, reduced motion and a hidden tab stop it;
 *   - every theme draws every place, and only its own files;
 *   - how loud each layer is, is a number that has a ceiling.
 * The rule that nothing is drawn behind a figure is in themes-decor-guards.test.ts.
 */

const css = renderDecorCss();
const { rules, keyframes } = parseCss(css);

/** The stylesheet without its comments: prose in a comment ("ivory and green") is not a colour in a rule. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

const forTheme = (theme: ThemeKey) => rules.filter((r) => r.selector.includes(`[data-theme="${theme}"]`));
/**
 * The rule(s) of one theme and one place whose selector ends with `tail` (a pseudo-element or a child). The
 * motion rules (which start with the level, `[data-decor="full"]…`) are not the drawing and are left out.
 */
const rulesOf = (theme: ThemeKey, selectorTail: string, at: string | null = null): CssRule[] =>
  forTheme(theme).filter((r) => r.at === at && r.selector.endsWith(selectorTail) && !r.selector.startsWith("[data-decor"));
const one = (list: CssRule[], what: string): CssRule => {
  expect(list, what).toHaveLength(1);
  return list[0] as CssRule;
};
const urlsIn = (value: string): string[] => [...value.matchAll(/url\(([^)]+)\)/g)].map((m) => (m[1] as string).replace(/["']/g, ""));
/** The files a set of rules asks for (the star tile is drawn in code: a data: URL, no file). */
const filesOfRules = (list: CssRule[]): string[] =>
  list.flatMap((r) => r.decls.flatMap(([, v]) => urlsIn(v))).filter((u) => !u.startsWith("data:")).map((u) => u.replace("/brand/decor/", ""));
const PATTERN_KEYS = Object.keys(PATTERN) as Array<keyof typeof PATTERN>;

describe("the stylesheet is generated, and the committed file is what the generator makes", () => {
  it("decor.css equals renderDecorCss() — no hand edit, no stale copy", () => {
    expect(normalizeText(read("src", "components", "theme", "decor.css"))).toBe(normalizeText(css));
  });

  it("the build script agrees with the committed file (the script itself works, not only the function)", () => {
    // `--check` writes nothing and exits 1 on drift; a script that cannot even start fails here too
    expect(() =>
      execFileSync(process.execPath, ["scripts/build-decor-css.mjs", "--check"], { cwd: ROOT, stdio: "pipe", timeout: 60_000 }),
    ).not.toThrow();
  }, 90_000);

  it("says on its first lines that it is generated, and by what", () => {
    const head = css.slice(0, 400);
    expect(head).toContain("GENERATED");
    expect(head).toContain("scripts/build-decor-css.mjs");
    expect(head).toContain("src/lib/themes/decor.ts");
    expect(read("src", "components", "theme", "decor.css").charCodeAt(0), "BOM").not.toBe(0xfeff);
    expect(DECOR_CSS_FILE.endsWith("decor.css")).toBe(true);
  });
});

describe("it names no colour of its own: every colour is a variable of the theme", () => {
  it("— no hex, no rgb()/hsl() literal, no named colour", () => {
    expect(code, "hex colour").not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code, "colour function with numbers").not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.]/i);
    expect(code, "named colour").not.toMatch(/[:\s,(](?:white|black|red|green|blue|gray|grey|silver|gold|navy|teal|currentcolor)\s*[;,)\s]/i);
  });

  it("— every rgb() takes its channels from a variable", () => {
    const calls = [...code.matchAll(/\brgb\(/g)];
    expect(calls.length).toBeGreaterThan(10);
    for (const call of code.matchAll(/\brgb\([^;]{0,24}/g)) expect(call[0], call[0]).toMatch(/^rgb\(var\(--[a-z0-9-]+\)/);
  });

  it("— and only the three the decoration is built from: accent, the star's gold (accent-2) and surface", () => {
    const names = new Set([...code.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect([...names].sort()).toEqual(["accent", "accent-2", "surface"]);
  });
});

describe("the layer itself", () => {
  const base = one(rules.filter((r) => r.selector === ".zk-decor" && r.at === null), "the base rule");

  it("— fills its parent, sits behind the content, takes no click", () => {
    expect(valueOf(base, "position")).toBe("absolute");
    expect(valueOf(base, "inset")).toBe("0");
    expect(valueOf(base, "z-index")).toBe("0");
    expect(valueOf(base, "pointer-events")).toBe("none");
    expect(valueOf(base, "overflow"), "a layer that moves must not draw outside its parent").toBe("hidden");
  });

  it("— its soft wash is the theme's accent at a low alpha, within the ceiling", () => {
    expect(WASH).toBeLessThanOrEqual(CAPS.wash);
    const bg = valueOf(base, "background") ?? "";
    expect(bg).toContain(`rgb(var(--accent) / ${WASH})`);
    expect(bg).not.toContain("url(");
  });

  it("— «off» draws nothing at all: the layer is not displayed, so no picture is ever requested", () => {
    const off = rules.filter((r) => r.selector === '[data-decor="off"] .zk-decor');
    expect(off).toHaveLength(1);
    expect(valueOf(off[0] as CssRule, "display")).toBe("none");
  });

  it("— and a high-contrast mode (forced colours) gets none of it", () => {
    const forced = rules.filter((r) => r.at?.includes("forced-colors: active") && r.selector === ".zk-decor");
    expect(forced).toHaveLength(1);
    expect(valueOf(forced[0] as CssRule, "display")).toBe("none");
  });
});

describe("«light» is still, «full» moves slowly — and it can always be stopped", () => {
  const animated = rules.filter((r) => r.decls.some(([p]) => p.startsWith("animation")));

  it("— nothing moves unless the level is «full» (or the rule is the one that stops it)", () => {
    expect(animated.length).toBeGreaterThan(0);
    for (const r of animated) {
      const stops = r.selector.includes("[data-decor-hidden]") || (r.at ?? "").includes("prefers-reduced-motion");
      expect(r.selector.includes('[data-decor="full"]') || stops, `${r.selector} moves at the light level`).toBe(true);
    }
  });

  it("— the three motions are 24 s drift, 420 s turn and 70 s zoom", () => {
    expect(MOTION).toEqual({ drift: 24, turn: 420, zoom: 70 });
    const moving = rules.flatMap((r) => r.decls.filter(([p, v]) => p === "animation" && v !== "none !important").map(([, v]) => ({ selector: r.selector, v })));
    const drift = moving.filter((m) => m.v.startsWith(`zk-decor-drift ${MOTION.drift}s`));
    const turn = moving.filter((m) => m.v.startsWith(`zk-decor-turn ${MOTION.turn}s`));
    const zoom = moving.filter((m) => m.v.startsWith(`zk-decor-zoom ${MOTION.zoom}s`));
    expect(drift.map((m) => m.selector)).toEqual(['[data-decor="full"][data-theme="night"] .zk-decor', '[data-decor="full"][data-theme="day"] .zk-decor']);
    expect(turn.map((m) => m.selector).sort()).toEqual(['[data-decor="full"][data-theme="islamic-epic"] .zk-decor-door::before']);
    expect(zoom.map((m) => m.selector)).toEqual(['[data-decor="full"][data-theme="neon-coast"] .zk-decor-door']);
    expect(keyframes.map((k) => k.name).sort()).toEqual(["zk-decor-drift", "zk-decor-turn", "zk-decor-zoom"]);
  });

  it("— a picture never drifts (that would show a seam of page along one edge): the photographs only zoom from the centre", () => {
    const zoom = keyframes.find((k) => k.name === "zk-decor-zoom");
    expect(zoom?.body.replace(/\s+/g, "")).toBe("to{transform:scale(1.06);}");
    const neon = animated.filter((r) => r.selector.includes('data-theme="neon-coast"'));
    for (const r of neon) expect(valueOf(r, "animation") ?? "", r.selector).toContain("zk-decor-zoom");
    // the corners and the skyline are anchored to the edges: the Islamic themes turn the rosette and nothing else
    const islamic = animated.filter((r) => /data-theme="islamic-epic"/.test(r.selector));
    for (const r of islamic) expect(valueOf(r, "animation") ?? "", r.selector).toContain("zk-decor-turn");
  });

  it("— reduced motion removes every animation outright (not slows it)", () => {
    const reduced = rules.filter((r) => (r.at ?? "").includes("prefers-reduced-motion: reduce") && r.decls.some(([p]) => p === "animation"));
    expect(reduced.map((r) => r.selector).sort()).toEqual([".zk-decor", ".zk-decor::after", ".zk-decor::before"]);
    for (const r of reduced) expect(valueOf(r, "animation"), r.selector).toBe("none !important");
  });

  it("— a hidden tab pauses it (the data attribute is set by watchDecorVisibility)", () => {
    const paused = rules.filter((r) => r.selector.startsWith("[data-decor-hidden]"));
    expect(paused.map((r) => r.selector).sort()).toEqual(["[data-decor-hidden] .zk-decor", "[data-decor-hidden] .zk-decor::after", "[data-decor-hidden] .zk-decor::before"]);
    for (const r of paused) expect(valueOf(r, "animation-play-state"), r.selector).toBe("paused !important");
  });
});

describe("every theme draws every place — and only its own files", () => {
  for (const theme of THEME_KEYS) {
    it(`${theme}: door, empty, sidebar and strip each have a rule of their own`, () => {
      for (const kind of DECOR_KINDS) {
        const mine = forTheme(theme).filter((r) => r.selector.includes(`.zk-decor-${kind}`) && !r.selector.startsWith('[data-decor="full"]'));
        expect(mine.length, `${theme} draws nothing for «${kind}»`).toBeGreaterThan(0);
      }
    });

    it(`${theme}: asks for every file it owns, and for nobody else's`, () => {
      const asked = new Set(filesOfRules(forTheme(theme)));
      expect([...asked].sort()).toEqual([...decorFilesOf(theme)].sort());
    });
  }

  it("— together they ask for exactly the files the module lists (the folder check is in themes-decor-files)", () => {
    const asked = new Set(filesOfRules(rules));
    expect([...asked].sort()).toEqual([...allDecorFiles()].sort());
  });

  it("— and nothing in the sheet is a rule for the bare page: every selector is the decoration's own", () => {
    for (const r of rules) {
      expect(r.selector, r.selector).toMatch(/zk-|data-decor|data-theme|data-art-slot/);
    }
  });
});

describe("a mask carries no colour of its own: the colour is the theme's accent, painted through it", () => {
  const masked = rules.filter((r) => r.decls.some(([p]) => p === "mask" || p === "-webkit-mask"));

  it("— there are masks («إسلامي ملحمي», «ليل» and «نهار»), and each is written for both Safari and the standard", () => {
    expect(masked.length).toBeGreaterThan(15);
    for (const r of masked) {
      const std = valueOf(r, "mask");
      const webkit = valueOf(r, "-webkit-mask");
      expect(webkit, `${r.selector}: Safari's prefix`).toBeDefined();
      expect(std, `${r.selector}: the standard property`).toBe(webkit);
    }
  });

  it("— and a mask is painted from the accent through the mask, at a stated opacity", () => {
    for (const r of masked.filter((m) => valueOf(m, "mask")?.includes("url(/brand/decor/"))) {
      expect(valueOf(r, "background-color"), r.selector).toBe("rgb(var(--accent))");
      expect(Number(valueOf(r, "opacity")), `${r.selector}: opacity`).toBeGreaterThan(0);
    }
  });

  it("— the files of a mask are .webp under /brand/decor, or the star tile drawn in code — nothing else, nothing from another site", () => {
    const tiles = new Set(PATTERN_KEYS.map((k) => patternTileUrl(PATTERN[k].tile)));
    for (const r of rules) {
      for (const [, v] of r.decls) {
        for (const u of urlsIn(v)) {
          if (u.startsWith("data:")) expect(tiles.has(u), r.selector).toBe(true);
          else expect(u, r.selector).toMatch(/^\/brand\/decor\/[a-z.-]+\.webp$/);
        }
      }
    }
  });
});

describe("how loud each layer is has a number, and the number has a ceiling", () => {
  it("— the composed themes: rosette ≤ 0.2 (it sits where the text is), corner and skyline ≤ 0.3, the rosette the quietest", () => {
    for (const [theme, c] of Object.entries(COMPOSED)) {
      expect(c.rosette, `${theme} rosette`).toBeLessThanOrEqual(CAPS.rosette);
      expect(c.corner, `${theme} corner`).toBeLessThanOrEqual(CAPS.corner);
      expect(c.skyline, `${theme} skyline`).toBeLessThanOrEqual(CAPS.skyline);
      expect(c.rosette, `${theme}: the rosette is quieter than the corner`).toBeLessThan(c.corner);
      expect(c.rosette, theme).toBeGreaterThan(0.05);
    }
    expect(CAPS).toMatchObject({ rosette: 0.2, corner: 0.3, skyline: 0.3 });
  });

  it("— the field of stars of «ليل» and «نهار» is quiet (it is behind words): at most 0.12, day no louder than night", () => {
    expect(CAPS.pattern).toBeLessThanOrEqual(0.12);
    for (const key of PATTERN_KEYS) {
      expect(PATTERN[key].ink, key).toBeLessThanOrEqual(CAPS.pattern);
      expect(PATTERN[key].ink, key).toBeGreaterThan(0.03);
    }
    expect(PATTERN.day.ink).toBeLessThanOrEqual(PATTERN.night.ink);
  });

  it("— the photographs: the empty-list picture ≤ 0.2, the panel under the words at least 0.75", () => {
    const p = PHOTOGRAPHIC["neon-coast"];
    expect(p.empty).toBeLessThanOrEqual(CAPS.empty);
    expect(p.panel).toBeGreaterThanOrEqual(CAPS.panelMin);
    expect(SCRIM.alpha).toBeGreaterThanOrEqual(CAPS.panelMin);
    expect(p.header[0]).toBeGreaterThan(p.header[1]);
    expect(p.veil.every((v) => v > 0 && v < 1)).toBe(true);
  });

  it("— and the stylesheet says exactly the numbers the tables hold (the numbers that tests below check)", () => {
    for (const [theme, c] of Object.entries(COMPOSED) as Array<[ThemeKey, (typeof COMPOSED)["islamic-epic"]]>) {
      const rosette = one(rulesOf(theme, ".zk-decor-door::before"), `${theme} door rosette`);
      const corner = one(rulesOf(theme, ".zk-decor-door::after"), `${theme} door corner`);
      const skyline = one(rulesOf(theme, ".zk-decor-door .zk-decor-b"), `${theme} door skyline`);
      expect(valueOf(rosette, "opacity")).toBe(String(c.rosette));
      expect(valueOf(corner, "opacity")).toBe(String(c.corner));
      expect(valueOf(skyline, "opacity")).toBe(String(c.skyline));
    }
    for (const key of PATTERN_KEYS) {
      const drawn = forTheme(key).filter((r) => valueOf(r, "opacity"));
      expect(drawn.length).toBe(4);
      for (const r of drawn) expect(valueOf(r, "opacity"), r.selector).toBe(String(PATTERN[key].ink));
    }
  });
});

describe("«إسلامي ملحمي» wears three drawings, each in its own place", () => {
  const themes = Object.keys(COMPOSED) as Array<keyof typeof COMPOSED>;

  it("— the door: a rosette, a corner at each top corner (the left one is the right one turned), and the skyline", () => {
    for (const theme of themes) {
      const rosette = one(rulesOf(theme, ".zk-decor-door::before"), `${theme} rosette`);
      expect(valueOf(rosette, "mask")).toContain(`${theme}.rosette.webp`);
      expect(valueOf(rosette, "mask")).toContain("center / min(92vmin, 1000px)");

      const right = one(rulesOf(theme, ".zk-decor-door::after"), `${theme} right corner`);
      expect(valueOf(right, "mask")).toContain(`${theme}.corner.webp`);
      expect(valueOf(right, "mask")).toContain("right top / min(46vmin, 420px) auto");

      const left = one(rulesOf(theme, ".zk-decor-door .zk-decor-l"), `${theme} left corner`);
      expect(valueOf(left, "mask"), "the left corner is the same file").toContain(`${theme}.corner.webp`);
      expect(valueOf(left, "transform")).toBe("scaleX(-1)");
      expect(valueOf(left, "display")).toBe("block");

      const skyline = one(rulesOf(theme, ".zk-decor-door .zk-decor-b"), `${theme} skyline`);
      expect(valueOf(skyline, "mask")).toContain(`${theme}.skyline.webp`);
      expect(valueOf(skyline, "mask")).toContain("center bottom / min(100%, 1700px) auto");
    }
  });

  it("— an empty list: the rosette alone, in a square of at most 320 px centred behind the words", () => {
    for (const theme of themes) {
      const r = one(rulesOf(theme, ".zk-decor-empty::after"), `${theme} empty rosette`);
      expect(valueOf(r, "mask")).toContain(`${theme}.rosette.webp`);
      expect(valueOf(r, "mask")).toContain("center / contain");
      expect(valueOf(r, "width")).toBe("min(320px, 100%)");
      expect(valueOf(r, "height")).toBe("min(320px, 100%)");
      expect(valueOf(r, "margin")).toBe("auto");
    }
  });

  it("— the 72 px header: one corner, turned, at the end away from the wordmark", () => {
    for (const theme of themes) {
      const r = one(rulesOf(theme, ".zk-decor-sidebar::after"), `${theme} sidebar corner`);
      expect(valueOf(r, "mask")).toContain(`${theme}.corner.webp`);
      expect(valueOf(r, "mask")).toContain("170px auto");
      expect(valueOf(r, "transform")).toBe("scaleX(-1)");
    }
  });

  it("— the Today strip: the skyline along the bottom at the end side, fitted to the strip, the start side left clear for the words", () => {
    for (const theme of themes) {
      const r = one(rulesOf(theme, ".zk-decor-strip::before"), `${theme} strip skyline`);
      expect(valueOf(r, "mask")).toContain(`${theme}.skyline.webp`);
      expect(valueOf(r, "mask")).toContain("center bottom / contain");
      expect(valueOf(r, "inset-inline-end"), "at the end side").toBe("0");
      expect(valueOf(r, "width")).toBe("min(55%, 560px)");
    }
  });

  it("— and only the door's rosette turns", () => {
    for (const theme of themes) {
      const motion = rules.filter((r) => r.selector.includes(`data-theme="${theme}"`) && r.decls.some(([p]) => p === "animation"));
      expect(motion.map((r) => r.selector)).toEqual([`[data-decor="full"][data-theme="${theme}"] .zk-decor-door::before`]);
    }
  });
});

describe("«ليل» and «نهار» wear a field of eight-pointed stars, drawn in code, in the star's gold", () => {
  it("— the door, an empty list, the header and the strip: the tile, repeated, painted in accent-2 at the one ink", () => {
    for (const key of PATTERN_KEYS) {
      const { ink, tile } = PATTERN[key];
      for (const tail of [".zk-decor-door::after", ".zk-decor-empty::after", ".zk-decor-sidebar::after", ".zk-decor-strip::after"]) {
        const r = one(rulesOf(key, tail), `${key} ${tail}`);
        expect(valueOf(r, "mask")).toBe(`url(${patternTileUrl(tile)}) 0 0 / ${tile}px ${tile}px repeat`);
        expect(valueOf(r, "-webkit-mask")).toBe(valueOf(r, "mask"));
        expect(valueOf(r, "background-color")).toBe("rgb(var(--accent-2))");
        expect(valueOf(r, "opacity")).toBe(String(ink));
      }
      const empty = one(rulesOf(key, ".zk-decor-empty::after"), `${key} empty`);
      expect(valueOf(empty, "width")).toBe("min(320px, 100%)");
    }
  });

  it("— the tile is an eight-pointed star in the middle and a quarter star at each corner, and asks for nothing", () => {
    const svg = patternTileSvg(56);
    const polygons = [...svg.matchAll(/<polygon points="([^"]+)"\/>/g)].map((m) => (m[1] as string).split(" "));
    expect(polygons).toHaveLength(5);
    for (const points of polygons) expect(points).toHaveLength(16);
    expect(svg).not.toMatch(/href|<image|<script|url\(/);
    expect(patternTileUrl(56)).toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  });

  it("— and at the full level these two are the ones that drift (a tile has no edge to uncover)", () => {
    const drift = rules.filter((r) => valueOf(r, "animation")?.startsWith("zk-decor-drift"));
    expect(drift.map((r) => r.selector)).toEqual(PATTERN_KEYS.map((k) => `[data-decor="full"][data-theme="${k}"] .zk-decor`));
  });
});

describe("«ساحل النيون» wears photographs, on a veil made from the theme's own surface", () => {
  const p = PHOTOGRAPHIC["neon-coast"];
  const veil = (n: number) => `rgb(var(--surface) / ${n})`;
  const tail = (list: CssRule[]) => list.filter((r) => r.at === null);
  const portrait = (list: CssRule[]) => list.filter((r) => r.at === "@media (orientation: portrait)");
  const neon = forTheme("neon-coast");

  it("— the door: the wide picture, or the portrait one when the window is taller than wide; never a rule that names both", () => {
    const plain = one(tail(neon.filter((r) => r.selector === '[data-theme="neon-coast"] .zk-decor-door')), "door");
    const tall = one(portrait(neon.filter((r) => r.selector === '[data-theme="neon-coast"] .zk-decor-door')), "door, portrait");
    const wide = valueOf(plain, "background") ?? "";
    const high = valueOf(tall, "background") ?? "";
    expect(wide).toContain(`/brand/decor/${p.door}`);
    expect(high).toContain(`/brand/decor/${p.doorTall}`);
    expect(wide.includes(p.doorTall) || high.includes(p.door), "one rule names both pictures").toBe(false);
    // the picture and its veil are ONE declaration: a browser that drops it shows the plain wash, never a picture with no veil
    for (const bg of [wide, high]) {
      expect(bg).toMatch(/^linear-gradient\(180deg, rgb\(var\(--surface\) \/ [\d.]+\) 0%, .*\), url\(\/brand\/decor\/[\w.-]+\.webp\) center bottom \/ cover no-repeat$/);
      expect(bg).toContain(`${veil(p.veil[0])} 0%`);
      expect(bg).toContain(`${veil(p.veil[1])} 45%`);
      expect(bg).toContain(`${veil(p.veil[2])} 100%`);
    }
  });

  it("— the text column of the door becomes a panel of the page's own colour, the thing every word is read against", () => {
    const panel = rules.filter((r) => r.selector === '[data-theme="neon-coast"]:not([data-decor="off"]) .zk-door-column');
    const r = one(panel, "the neon panel");
    expect(valueOf(r, "background")).toBe(veil(p.panel));
    expect(valueOf(r, "backdrop-filter")).toBe("blur(10px)");
    expect(valueOf(r, "-webkit-backdrop-filter")).toBe("blur(10px)");
    expect(valueOf(r, "border-radius")).toBeDefined();
  });

  it("— an empty list: the same picture, faint, faded to nothing at its edges", () => {
    const r = one(tail(neon.filter((r2) => r2.selector === '[data-theme="neon-coast"] .zk-decor-empty')), "empty");
    expect(valueOf(r, "background")).toContain(`/brand/decor/${p.door}`);
    expect(valueOf(r, "opacity")).toBe(String(p.empty));
    expect(valueOf(r, "mask")).toMatch(/^radial-gradient\(ellipse at center, rgb\(var\(--surface\)\) 38%, transparent 80%\)$/);
    expect(valueOf(r, "-webkit-mask")).toBe(valueOf(r, "mask"));
    const tall = one(portrait(neon.filter((r2) => r2.selector === '[data-theme="neon-coast"] .zk-decor-empty')), "empty, portrait");
    expect(valueOf(tall, "background")).toContain(p.doorTall);
  });

  it("— the header and the strip: the strip picture under a veil heaviest at the start (right) side, where the words are", () => {
    for (const kind of ["sidebar", "strip"]) {
      const r = one(tail(neon.filter((r2) => r2.selector === `[data-theme="neon-coast"] .zk-decor-${kind}`)), `neon ${kind}`);
      const bg = valueOf(r, "background") ?? "";
      expect(bg).toContain(`linear-gradient(to left, ${veil(p.header[0])} 0%, ${veil(p.header[0])} 55%, ${veil(p.header[1])} 100%)`);
      expect(bg).toContain(`url(/brand/decor/${p.strip}) right center / cover no-repeat`);
    }
  });

  it("— and at the full level only the door moves: it zooms from its centre", () => {
    const moving = neon.filter((r) => r.decls.some(([prop]) => prop === "animation"));
    expect(moving.map((r) => r.selector)).toEqual(['[data-decor="full"][data-theme="neon-coast"] .zk-decor-door']);
  });
});

describe("text over a picture sits on a scrim; a picture the owner adds later is picked up by name", () => {
  it("— `.zk-scrim` is the panel to put under words that sit over a picture", () => {
    const r = one(rules.filter((x) => x.selector === ".zk-scrim"), ".zk-scrim");
    expect(valueOf(r, "background")).toBe(`rgb(var(--surface) / ${SCRIM.alpha})`);
    expect(valueOf(r, "backdrop-filter")).toBe(`blur(${SCRIM.blur}px)`);
    expect(valueOf(r, "-webkit-backdrop-filter")).toBe(`blur(${SCRIM.blur}px)`);
  });

  it("— the login-door picture covers the door when it has loaded, and only then is the text column a scrim panel", () => {
    const art = one(rules.filter((r) => r.selector === ".zk-door-art" && r.at === null), ".zk-door-art");
    expect(valueOf(art, "position")).toBe("absolute");
    expect(valueOf(art, "object-fit")).toBe("cover");
    expect(valueOf(art, "opacity")).toBe("0");
    const loaded = one(rules.filter((r) => r.selector === '.zk-door-art[data-state="loaded"]'), "loaded");
    expect(valueOf(loaded, "opacity")).toBe("1");
    const panel = one(rules.filter((r) => r.selector === '.zk-door-art[data-state="loaded"] ~ .zk-door-column'), "panel");
    expect(valueOf(panel, "background")).toBe(`rgb(var(--surface) / ${SCRIM.alpha})`);
  });

  it("— the two scene pictures (login door, Today strip) belong to the Islamic themes only, and «off» hides them", () => {
    const hidden = one(rules.filter((r) => r.selectors.includes('[data-art-slot="login-door"]') && r.selector === '[data-art-slot="login-door"]'), "scene hidden");
    expect(valueOf(hidden, "display")).toBe("none");
    const shown = rules.filter((r) => valueOf(r, "display") === "block" && r.selector.includes("[data-art-slot="));
    const themesShown = new Set(shown.flatMap((r) => [...r.selector.matchAll(/data-theme="([a-z-]+)"/g)].map((m) => m[1])));
    expect([...themesShown].sort()).toEqual(["islamic-epic"]);
    const off = rules.filter((r) => r.selector.startsWith('[data-decor="off"] [data-art-slot='));
    expect(off.map((r) => r.selector).sort()).toEqual(['[data-decor="off"] [data-art-slot="login-door"]', '[data-decor="off"] [data-art-slot="today-strip"]']);
  });

  it("— reduced motion also removes the fade of a picture", () => {
    const r = rules.filter((x) => (x.at ?? "").includes("prefers-reduced-motion") && x.decls.some(([p]) => p === "transition"));
    expect(r.length).toBeGreaterThan(0);
  });
});
