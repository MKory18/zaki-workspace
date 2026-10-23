import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_KEYS, type ThemeKey } from "@/lib/themes/registry";
import { COMPOSED, FAINT, PHOTOGRAPHIC, SCRIM, WASH } from "@/lib/themes/decor";
import { BLACK, DECOR_DIR, SRC, WHITE, contrast, luminance, over, themeTokens, type Rgb } from "./themes-decor-helpers";

/**
 * EVERY WORD STAYS READABLE, WHATEVER IS BEHIND IT.
 *
 * A picture can be replaced by anybody and a number nudged by anybody who reads it as taste, so the words are
 * held against the WORST picture there could be, composited the way a browser composites it, through the very
 * numbers the stylesheet ships (they are imported from decor.ts, never copied here).
 *
 * Which words: the three colours text may have on a decorated surface — `fg`, `fg-muted`, `accent`. The dimmer
 * `muted` is for text that sits on a card, never over a picture (themes-decor-guards.test.ts holds that).
 * Error text (`danger`) lives inside the form card, which is opaque, so it is never over a picture either.
 */

const { source, byTheme } = themeTokens();
const WORDS = ["fg", "fg-muted", "accent"] as const;
const BAR = 4.5;

const ratio = (word: Rgb, backdrop: Rgb) => contrast(word, backdrop);

describe("where the palettes come from", () => {
  it("— the generated theme stylesheet, as soon as it exists (the OMS-derived fallback is only for before it does)", () => {
    const generated = path.join(SRC, "app", "themes.css");
    if (existsSync(generated)) {
      expect(source, "src/app/themes.css exists but the decoration tests could not read its tokens").toBe("themes.css");
    } else {
      expect(source).toBe("fallback");
    }
  });

  it("— every theme has the tokens these claims are read against", () => {
    for (const key of THEME_KEYS) {
      for (const name of ["surface", "surface-1", "surface-2", "fg", "fg-muted", "accent"] as const) {
        const c = byTheme[key][name];
        expect(c, `${key} ${name}`).toHaveLength(3);
        for (const v of c) expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("«ساحل النيون» — the door: the panel of the page's own colour carries every word", () => {
  const p = PHOTOGRAPHIC["neon-coast"];
  const t = byTheme["neon-coast"];

  it("— over the worst picture there could be (pure white), through the shipped panel", () => {
    const backdrop = over(t.surface, WHITE, p.panel);
    for (const word of WORDS) {
      const r = ratio(t[word], backdrop);
      expect(r, `${word} over white = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(BAR);
    }
  });

  it("— and over the brightest region of each REAL door photograph", async () => {
    const sharp = (await import("sharp")).default;
    for (const file of [p.door, p.doorTall]) {
      const { data, info } = await sharp(path.join(DECOR_DIR, file)).resize(32, 18, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
      let brightest: Rgb = [0, 0, 0];
      let best = -1;
      for (let i = 0; i < data.length; i += info.channels) {
        const px: Rgb = [data[i] as number, data[i + 1] as number, data[i + 2] as number];
        const l = luminance(px);
        if (l > best) {
          best = l;
          brightest = px;
        }
      }
      const backdrop = over(t.surface, brightest, p.panel);
      for (const word of WORDS) {
        const r = ratio(t[word], backdrop);
        expect(r, `${file}: ${word} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(BAR);
      }
    }
  });

  it("— and the check can fail: with no panel the same white picture is unreadable, and a thin panel is not enough", () => {
    // a guard nobody has seen fail is not a guard
    expect(ratio(t["fg-muted"], over(t.surface, WHITE, 0))).toBeLessThan(2);
    expect(ratio(t["fg-muted"], over(t.surface, WHITE, 0.3))).toBeLessThan(BAR);
  });
});

describe("«ساحل النيون» — an empty list: the faint picture, behind its sentence, over every surface a list stands on", () => {
  const p = PHOTOGRAPHIC["neon-coast"];
  const t = byTheme["neon-coast"];

  it("— white at the picture's own opacity, over surface, card and tinted surface", () => {
    for (const surface of ["surface", "surface-1", "surface-2"] as const) {
      const backdrop = over(WHITE, t[surface], p.empty);
      for (const word of WORDS) {
        const r = ratio(t[word], backdrop);
        expect(r, `${surface}: ${word} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(BAR);
      }
    }
  });

  it("— and a picture at half strength would not be (the ceiling is real)", () => {
    expect(ratio(t["fg-muted"], over(WHITE, t["surface-2"], 0.5))).toBeLessThan(BAR);
  });
});

describe("«ساحل النيون» — the header and the Today strip: the veil, heaviest where the words are", () => {
  const p = PHOTOGRAPHIC["neon-coast"];
  const t = byTheme["neon-coast"];

  it("— the words sit over the heavy end of the veil; the picture under it is, at worst, pure white", () => {
    const backdrop = over(t.surface, WHITE, p.header[0]);
    for (const word of WORDS) {
      const r = ratio(t[word], backdrop);
      expect(r, `${word} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(BAR);
    }
  });

  it("— and over the brightest region of the REAL strip picture", async () => {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(path.join(DECOR_DIR, p.strip)).resize(40, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    let brightest: Rgb = [0, 0, 0];
    let best = -1;
    for (let i = 0; i < data.length; i += info.channels) {
      const px: Rgb = [data[i] as number, data[i + 1] as number, data[i + 2] as number];
      const l = luminance(px);
      if (l > best) {
        best = l;
        brightest = px;
      }
    }
    const backdrop = over(t.surface, brightest, p.header[0]);
    for (const word of WORDS) expect(ratio(t[word], backdrop), word).toBeGreaterThanOrEqual(BAR);
  });
});

describe("a picture the owner adds later — a scrim of the page's own colour, in every theme, over the best AND the worst picture", () => {
  for (const key of THEME_KEYS) {
    it(`${key}: pure white and pure black behind \`.zk-scrim\` (alpha ${SCRIM.alpha})`, () => {
      const t = byTheme[key];
      for (const picture of [WHITE, BLACK]) {
        const backdrop = over(t.surface, picture, SCRIM.alpha);
        for (const word of WORDS) {
          const r = ratio(t[word], backdrop);
          expect(r, `${key}: ${word} over ${picture[0] === 255 ? "white" : "black"} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(BAR);
        }
      }
    });
  }

  it("— and a thin scrim fails (a light theme's muted text over a dark picture), so the number is doing work", () => {
    const t = byTheme["islamic-calm"];
    expect(ratio(t["fg-muted"], over(t.surface, BLACK, 0.7))).toBeLessThan(BAR);
  });
});

describe("an ornament behind words — never louder than the words can bear", () => {
  const stacked = (layer: number) => 1 - (1 - WASH) * (1 - layer);

  for (const [key, c] of Object.entries(COMPOSED) as Array<[ThemeKey, (typeof COMPOSED)["islamic-calm"]]>) {
    it(`${key}: the rosette is drawn behind the words (the door's wordmark, an empty list's sentence): all three words ≥ 4.5`, () => {
      const t = byTheme[key];
      const backdrop = over(t.accent, t.surface, c.rosette);
      for (const word of WORDS) {
        const r = ratio(t[word], backdrop);
        expect(r, `${key}: ${word} under the rosette = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(BAR);
      }
    });

    it(`${key}: the corners and the skyline are at the edges — the heading ≥ 4.5 and the dimmer text ≥ 3, even with the wash stacked under them`, () => {
      const t = byTheme[key];
      for (const layer of [c.corner, c.skyline]) {
        const backdrop = over(t.accent, t.surface, stacked(layer));
        expect(ratio(t.fg, backdrop), `${key}: fg at the edge`).toBeGreaterThanOrEqual(BAR);
        expect(ratio(t["fg-muted"], backdrop), `${key}: fg-muted at the edge`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("«نهاري»: the faint mask, with the wash stacked under it, leaves the heading and the dimmer text above 4.5", () => {
    const t = byTheme.day;
    const backdrop = over(t.accent, t.surface, stacked(FAINT.day.ink));
    expect(ratio(t.fg, backdrop)).toBeGreaterThanOrEqual(BAR);
    expect(ratio(t["fg-muted"], backdrop)).toBeGreaterThanOrEqual(BAR);
  });

  it("every theme: the wash alone, at its strongest point, leaves the heading and the dimmer text above 4.5", () => {
    for (const key of THEME_KEYS) {
      const t = byTheme[key];
      const backdrop = over(t.accent, t.surface, WASH);
      expect(ratio(t.fg, backdrop), `${key}: fg`).toBeGreaterThanOrEqual(BAR);
      expect(ratio(t["fg-muted"], backdrop), `${key}: fg-muted`).toBeGreaterThanOrEqual(BAR);
    }
  });

  it("— and the claim can fail: a rosette at 0.5 would take the calm theme's dimmer text below the bar", () => {
    const t = byTheme["islamic-calm"];
    expect(ratio(t["fg-muted"], over(t.accent, t.surface, 0.5))).toBeLessThan(BAR);
  });
});
