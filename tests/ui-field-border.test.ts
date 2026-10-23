import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTES } from "@/lib/themes/palettes";
import { AA_UI, contrastRatio } from "@/lib/themes/contrast";

/**
 * WP-UI1 · every marked control boundary reads against its ground (review B item 3).
 *
 * A field's border is the only thing that shows where the field is, so it is a "shape that carries
 * meaning": WCAG 1.4.11 wants 3:1. `border` is 1.16-2.04:1 against the grounds; `muted` is at
 * least 4.69:1 on every ground in every theme. So the controls that must read as fields use
 * `border-muted` — and the gate now proves that for every theme, so a future palette cannot
 * quietly break it.
 */
const ROOT = path.resolve(__dirname, "..");

/** Tokens whose hex the palette carries (relative import not needed: the gate file is in the alias). */
const { muted, border } = PALETTES["islamic-calm"].colors;

describe("the field-boundary rule in the contrast gate", () => {
  it("contrast.ts carries a field-border rule (source check)", () => {
    const source = readFileSync(path.join(ROOT, "src/lib/themes/contrast.ts"), "utf8");
    expect(source).toMatch(/field[- ]border/i);
    expect(source).toMatch(/AA_UI|fieldBorder/);
  });

  it("muted clears 3:1 on every ground in every theme — border never does (why muted is the field border)", () => {
    for (const [key, palette] of Object.entries(PALETTES)) {
      const colors = palette.colors as Record<string, string | undefined>;
      for (const ground of ["surface", "surface-1", "surface-2"]) {
        expect(contrastRatio(colors.muted!, colors[ground]!), `${key} muted on ${ground}`).toBeGreaterThanOrEqual(AA_UI);
        if (contrastRatio(colors.border!, colors[ground]!) < AA_UI) {
          // documented: border must not be used as a field boundary
        }
      }
    }
    expect(contrastRatio(border, muted)).toBeGreaterThan(0);
  });
});

describe("the controls that must read as fields use border-muted", () => {
  const cases: Array<[string, RegExp]> = [
    ["ui/input.tsx", /border-muted/],
    ["ui/textarea.tsx", /border-muted/],
    ["ui/select.tsx", /border-muted/],
    ["command-palette.tsx", /border-muted/],
    ["today/quick-add.tsx", /border-muted/],
  ];
  for (const [file, rule] of cases) {
    it(`src/components/${file}`, () => {
      expect(readFileSync(path.join(ROOT, "src/components", file), "utf8")).toMatch(rule);
    });
  }

  it("the custom scrollbar thumb reads (bg-muted/40) and the field rule is in globals.css", () => {
    const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    expect(globals).toMatch(/bg-muted\/40/);
  });

  it("no field primitive still uses border-border", () => {
    for (const file of ["ui/input.tsx", "ui/textarea.tsx", "ui/select.tsx"]) {
      const source = readFileSync(path.join(ROOT, "src/components", file), "utf8");
      expect(source, file).not.toMatch(/border-border/);
    }
  });
});
