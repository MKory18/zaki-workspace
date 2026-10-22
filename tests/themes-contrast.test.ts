import { describe, expect, it } from "vitest";
import { AA_TEXT, AA_UI, blend, contrastRatio, deltaEOK, hexToTriplet, parseHex, relativeLuminance } from "@/lib/themes/contrast";

/**
 * The colour maths the contrast gate stands on. If these are wrong every gate built on them is
 * wrong too, so they are pinned against values anybody can recompute (WCAG 2.x formulas).
 */
describe("parseHex / hexToTriplet", () => {
  it("reads #RRGGBB in either case into 0-255 channels", () => {
    expect(parseHex("#F6F1E7")).toEqual([246, 241, 231]);
    expect(parseHex("#0e5e55")).toEqual([14, 94, 85]);
  });

  it("writes the `R G B` triplet a Tailwind `rgb(var(--x) / <alpha-value>)` colour needs", () => {
    expect(hexToTriplet("#F6F1E7")).toBe("246 241 231");
    expect(hexToTriplet("#000000")).toBe("0 0 0");
    expect(hexToTriplet("#ffffff")).toBe("255 255 255");
  });

  it("refuses anything that is not a 6-digit hex colour (a typo must not become black)", () => {
    for (const bad of ["", "F6F1E7", "#F6F1E", "#F6F1E7F", "#GG0000", "rgb(0 0 0)", "#fff"]) {
      expect(() => parseHex(bad), bad).toThrow();
    }
  });
});

describe("relative luminance and contrast ratio (WCAG 2.x)", () => {
  it("white is 1, black is 0", () => {
    expect(relativeLuminance("#FFFFFF")).toBe(1);
    expect(relativeLuminance("#000000")).toBe(0);
  });

  it("black on white is 21:1, a colour on itself is 1:1, and the order does not matter", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 6);
    expect(contrastRatio("#0E5E55", "#0E5E55")).toBe(1);
  });

  it("matches published reference values", () => {
    // #777 on white is the classic "just fails AA" grey: 4.48:1
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    // #767676 on white is the lightest grey that passes: 4.54:1
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });

  it("names the two thresholds the gate uses", () => {
    expect(AA_TEXT).toBe(4.5);
    expect(AA_UI).toBe(3);
  });
});

describe("blend: a colour laid at an opacity over another (what bg-ok/10 paints)", () => {
  it("is the bottom colour at 0 and the top colour at 1", () => {
    expect(blend("#147D40", 0, "#FFFFFF")).toBe("#FFFFFF");
    expect(blend("#147D40", 1, "#FFFFFF")).toBe("#147D40");
  });

  it("mixes channel by channel and rounds", () => {
    expect(blend("#000000", 0.5, "#FFFFFF")).toBe("#808080");
    expect(blend("#FF0000", 0.1, "#FFFFFF")).toBe("#FFE6E6");
  });
});

describe("deltaEOK: how far apart two colours look (OKLab distance)", () => {
  it("is 0 for the same colour and about 1 from black to white", () => {
    expect(deltaEOK("#4DD9DB", "#4DD9DB")).toBe(0);
    expect(deltaEOK("#000000", "#FFFFFF")).toBeCloseTo(1, 3);
  });

  it("tells near-twins from clearly different colours", () => {
    // the OMS's chart-1 and chart-3 of «إسلامي هادي»: two purples nobody can tell apart in a legend
    expect(deltaEOK("#6029AE", "#7629AE")).toBeLessThan(0.05);
    expect(deltaEOK("#6029AE", "#0D798D")).toBeGreaterThan(0.2);
  });
});
