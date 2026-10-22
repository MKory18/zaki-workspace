import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../tailwind.config";
import { THEMES_CSS_FILE, renderThemesCss } from "@/lib/themes/css";
import { COLOR_TOKENS, PALETTES, STYLE_TOKENS } from "@/lib/themes/palettes";
import { hexToTriplet } from "@/lib/themes/contrast";
import { DEFAULT_THEME, THEME_KEYS, THEMES } from "@/lib/themes/registry";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  const at = start === -1 && css.startsWith(`${selector} {`) ? 0 : start;
  if (at === -1) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split(";")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

describe("renderThemesCss: the palettes as one static stylesheet", () => {
  const css = renderThemesCss();

  it("starts with a :root rule that IS the default theme, so a page without the attribute is correct", () => {
    const root = declarations(block(css, ":root"));
    const calm = declarations(block(css, `[data-theme="${DEFAULT_THEME}"]`));
    expect(root).toEqual(calm);
    expect(css.indexOf(":root {")).toBeLessThan(css.indexOf("[data-theme="));
  });

  for (const key of THEME_KEYS) {
    it(`${key}: one rule with color-scheme, every colour as a triplet and the style values`, () => {
      const d = declarations(block(css, `[data-theme="${key}"]`));
      expect(d["color-scheme"]).toBe(THEMES[key].dark ? "dark" : "light");
      for (const token of COLOR_TOKENS) expect(d[`--${token}`], token).toBe(hexToTriplet(PALETTES[key].colors[token]));
      for (const token of STYLE_TOKENS) expect(d[`--${token}`], token).toBe(PALETTES[key].style[token]);
      expect(css.split(`[data-theme="${key}"] {`).length - 1).toBe(1);
    });
  }

  it("uses LF line endings and ends with a newline (one byte-identical file on Windows and in CI)", () => {
    expect(css.endsWith("\n")).toBe(true);
    expect(css).not.toContain("\r");
  });

  it("is the same text every time (a generated file must not churn)", () => {
    expect(renderThemesCss()).toBe(css);
  });
});

describe("src/app/themes.css is the generated file, unchanged (drift)", () => {
  it("equals renderThemesCss() — after editing palettes.ts run: npx tsx scripts/build-themes-css.mjs", () => {
    expect(THEMES_CSS_FILE).toBe("src/app/themes.css");
    expect(read(THEMES_CSS_FILE)).toBe(renderThemesCss());
  });

  it("is UTF-8 without a byte-order mark", () => {
    const bytes = readFileSync(path.join(ROOT, THEMES_CSS_FILE));
    expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe("globals.css uses the generated palettes", () => {
  const globals = read("src/app/globals.css");

  it("imports themes.css first (an @import after a rule is ignored by the browser)", () => {
    const firstStatement = globals.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n")[0];
    expect(firstStatement).toBe('@import "./themes.css";');
  });

  it("no longer defines the old light/dark token blocks itself", () => {
    expect(globals).not.toMatch(/^:root\s*\{/m);
    expect(globals).not.toMatch(/^\.dark\s*\{/m);
    expect(globals).not.toMatch(/--surface\s*:/);
  });

  it("titles (h1-h3) use the theme's display face", () => {
    expect(globals).toMatch(/h1,\s*h2,\s*h3\s*\{[^}]*font-family:\s*var\(--font-display\)/);
  });

  it("respects prefers-reduced-motion everywhere", () => {
    const at = globals.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(-1);
    const rule = globals.slice(at, globals.indexOf("}\n}", at));
    expect(rule).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(rule).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(rule).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });
});

describe("tailwind.config exposes every token", () => {
  const extend = (tailwindConfig.theme?.extend ?? {}) as Record<string, Record<string, unknown>>;

  it("as an alpha-capable colour: rgb(var(--x) / <alpha-value>)", () => {
    const colors = extend["colors"] ?? {};
    for (const token of COLOR_TOKENS) expect(colors[token], token).toBe(`rgb(var(--${token}) / <alpha-value>)`);
  });

  it("keeps every colour name the code already uses", () => {
    const colors = extend["colors"] ?? {};
    for (const name of ["surface", "surface-1", "surface-2", "border", "muted", "fg", "fg-muted", "accent", "accent-fg"]) {
      expect(colors[name], name).toBeDefined();
    }
  });

  it("has the display face, the card radius and the card shadow of the theme", () => {
    expect(extend["fontFamily"]?.["display"]).toEqual(["var(--font-display)"]);
    expect(extend["borderRadius"]?.["card"]).toBe("var(--radius-card)");
    expect(extend["boxShadow"]?.["card"]).toBe("var(--shadow-card)");
  });

  it("the body face is the font the layout actually loads (--font-plex, not an undefined --font-sans)", () => {
    const sans = extend["fontFamily"]?.["sans"] as string[];
    expect(sans[0]).toBe("var(--font-plex)");
  });

  it("keeps `dark:` working off the class the dark themes carry", () => {
    expect(tailwindConfig.darkMode).toBe("class");
  });
});
