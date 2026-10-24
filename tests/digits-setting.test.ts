import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, statSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { ThemePicker } from "@/components/theme/theme-picker";
import { DigitsProvider } from "@/components/theme/digits-provider";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { DEFAULT_DIGITS, DIGITS_COOKIE, DIGIT_MODES, DIGIT_SAMPLES, digitsOf, isDigitMode } from "@/lib/digits";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const WEIGHTS = [400, 500, 600, 700] as const;

/**
 * «الأرقام: 123 / ١٢٣» — the setting, the font that does the drawing, and the rules of the stylesheet. The route and
 * the sign-in are in tests/db/digits-route.test.ts.
 */

describe("the modes", () => {
  it("are «latin» (the default, what everybody sees today) and «arabic»; anything else reads as the default", () => {
    expect([...DIGIT_MODES]).toEqual(["latin", "arabic"]);
    expect(DEFAULT_DIGITS).toBe("latin");
    expect(DIGITS_COOKIE).toBe("zk-digits");
    for (const value of ["", "ARABIC", "hindi", null, undefined, 1, {}]) {
      expect(isDigitMode(value), String(value)).toBe(false);
      expect(digitsOf(value), String(value)).toBe("latin");
    }
    expect(digitsOf("arabic")).toBe("arabic");
    expect(DIGIT_SAMPLES).toEqual({ latin: "123", arabic: "١٢٣" });
  });
});

// ── the font, read back from its bytes ──────────────────────────────────────────────────────────────

/** A WOFF2's tables (all of them: this file has no transformed glyf/loca worth reading here). */
function woff2Tables(buf: Buffer): Map<string, Buffer> {
  expect(buf.subarray(0, 4).toString("ascii")).toBe("wOF2");
  const numTables = buf.readUInt16BE(12);
  const totalCompressed = buf.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buf[at++]!;
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("bad UIntBase128");
  };
  const KNOWN = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];
  const dir: Array<{ tag: string; length: number }> = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[at++]!;
    const index = flags & 0x3f;
    const tag = index === 63 ? buf.subarray(at, (at += 4)).toString("latin1") : KNOWN[index]!;
    const version = (flags >> 6) & 0x03;
    const origLength = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    const length = transformed ? base128() : origLength;
    dir.push({ tag, length });
  }
  const data = brotliDecompressSync(buf.subarray(at, at + totalCompressed));
  const tables = new Map<string, Buffer>();
  let offset = 0;
  for (const { tag, length } of dir) {
    tables.set(tag, data.subarray(offset, offset + length));
    offset += length;
  }
  return tables;
}

/** code point -> glyph id, from the cmap's format-4 subtable. */
function cmap4(cmap: Buffer): Map<number, number> {
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4);
    if (cmap.readUInt16BE(offset) !== 4) continue;
    const t = cmap.subarray(offset);
    const segX2 = t.readUInt16BE(6);
    const ends = 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    const out = new Map<number, number>();
    for (let s = 0; s < segX2 / 2; s++) {
      const end = t.readUInt16BE(ends + s * 2);
      const start = t.readUInt16BE(starts + s * 2);
      const delta = t.readInt16BE(deltas + s * 2);
      const rangeOffset = t.readUInt16BE(ranges + s * 2);
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        let glyph: number;
        if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
        else {
          const g = t.readUInt16BE(ranges + s * 2 + rangeOffset + (cp - start) * 2);
          glyph = g === 0 ? 0 : (g + delta) & 0xffff;
        }
        if (glyph) out.set(cp, glyph);
      }
    }
    return out;
  }
  throw new Error("no format-4 cmap");
}

describe("the font «Zaki Digits» (public/fonts, built by scripts/make-digits-fonts.py)", () => {
  for (const weight of WEIGHTS) {
    it(`${weight}: a real WOFF2 of about a kilobyte whose 0-9 draw the glyphs of ٠-٩, and nothing else`, () => {
      const file = path.join(ROOT, "public/fonts", `zaki-digits-${weight}.woff2`);
      expect(statSync(file).size).toBeLessThan(2048);
      const tables = woff2Tables(readFileSync(file));
      const map = cmap4(tables.get("cmap")!);
      for (let i = 0; i < 10; i++) {
        const western = map.get(0x30 + i);
        expect(western, `digit ${i}`).toBeDefined();
        expect(western, `digit ${i} draws ${String.fromCodePoint(0x660 + i)}`).toBe(map.get(0x660 + i));
      }
      // the ten shapes are ten different glyphs, and no letter came along
      expect(new Set([...Array(10).keys()].map((i) => map.get(0x30 + i))).size).toBe(10);
      expect([...map.keys()].filter((cp) => !(cp >= 0x30 && cp <= 0x39) && !(cp >= 0x660 && cp <= 0x669))).toEqual([]);
      // OS/2 says its weight, so the @font-face ranges below pick the right file
      expect(tables.get("OS/2")!.readUInt16BE(4)).toBe(weight);
    });
  }

  it("is not called «Plex» (the OFL's Reserved Font Name), and its licence travels with it", () => {
    const name = woff2Tables(readFileSync(path.join(ROOT, "public/fonts/zaki-digits-400.woff2"))).get("name")!;
    const text = name.toString("latin1") + name.toString("utf16le").replace(/\0/g, "");
    expect(text).toContain("Zaki Digits");
    expect(text).not.toContain("Plex");
    const ofl = read("public/fonts/zaki-digits-OFL.txt");
    expect(ofl).toContain('Reserved Font Name "Plex"');
    expect(ofl).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(read("public/brand/CREDITS.md")).toMatch(/fonts\/zaki-digits-\{400,500,600,700\}\.woff2[^\n]*OFL/);
  });
});

describe("the stylesheet draws, it does not rewrite", () => {
  const css = read("src/app/globals.css");

  it("four faces, one per weight, each for 0-9 only (a browser on «123» never downloads one)", () => {
    for (const weight of WEIGHTS) {
      const face = new RegExp(`@font-face \\{[^}]*src: url\\("/fonts/zaki-digits-${weight}\\.woff2"\\)[^}]*unicode-range: U\\+0030-0039;`);
      expect(css, String(weight)).toMatch(face);
    }
    expect([...css.matchAll(/font-family: "Zaki Digits";/g)]).toHaveLength(4);
  });

  it("with «١٢٣» the font comes first in the body, the headings, the wordmark and the font utilities", () => {
    expect(css).toMatch(/\[data-digits="arabic"\] body \{\s*font-family: "Zaki Digits", var\(--font-plex\)/);
    expect(css).toMatch(/\[data-digits="arabic"\] :is\(h1, h2, h3\),\s*\[data-digits="arabic"\] \.font-display \{\s*font-family: "Zaki Digits", var\(--font-display\)/);
    expect(css).toMatch(/\[data-digits="arabic"\] \.font-brand,\s*\[data-digits="arabic"\] \.zk-wordmark \{\s*font-family: "Zaki Digits", var\(--font-lalezar\)/);
  });

  it("a field and the «123» sample keep the Western shapes (what is typed is what is stored)", () => {
    const rule = /\[data-digits="arabic"\] :is\(input, textarea, select\),\s*\[data-digits="arabic"\] \.zk-digits-sample \{\s*font-family: ([^;]+);/.exec(css);
    expect(rule?.[1]).toBeDefined();
    expect(rule?.[1]).not.toContain("Zaki Digits");
  });
});

describe("the choice in the look sheet («المظهر»)", () => {
  const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
  // the provider's `children` is typed as required, which createElement(type, props, child) cannot express
  const Digits = DigitsProvider as unknown as FunctionComponent<{ initialDigits?: string; children?: ReactNode }>;
  const render = (initial?: string) =>
    renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Digits, { initialDigits: initial }, createElement(ThemePicker))));

  it("two 44px radios named in Arabic, each showing its own three digits; the saved one is checked", () => {
    const markup = render("arabic");
    expect(markup).toContain(AR["digits.picker"]);
    const radios = [...markup.matchAll(/<input[^>]*name="zk-digits"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(2);
    expect(radios.find((r) => r.includes('value="arabic"'))).toContain("checked");
    expect(radios.find((r) => r.includes('value="latin"'))).not.toContain("checked");
    for (const mode of DIGIT_MODES) expect(markup).toContain(`aria-label="${AR[`digits.${mode}`]}"`);
    expect(markup).toContain(">123<");
    expect(markup).toContain(">١٢٣<");
    expect(markup).toMatch(/class="zk-digits-sample"/);
  });

  it("with nothing saved, «123» is checked", () => {
    const radios = [...render().matchAll(/<input[^>]*name="zk-digits"[^>]*>/g)].map((m) => m[0]);
    expect(radios.find((r) => r.includes('value="latin"'))).toContain("checked");
  });
});
