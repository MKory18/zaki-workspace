import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Loading from "@/app/(app)/loading";
import { AR } from "@/lib/i18n/dict";
import { TIP_KEYS, TIP_ROTATION_MS, tipForAudience, tipSeed } from "@/lib/tips";
import { classesOf, textOf } from "./ui-render"; // (also puts the global React the TSX files need under vitest in place)

const NOON = Date.UTC(2026, 9, 22, 12, 0, 0);

const at = (ms: number) => {
  vi.spyOn(Date, "now").mockReturnValue(ms);
  return renderToStaticMarkup(createElement(Loading));
};

afterEach(() => vi.restoreAllMocks());

describe("the loading screen of the app (src/app/(app)/loading.tsx)", () => {
  it("needs no provider: it is a server component, so it reads the dictionary directly", () => {
    expect(() => renderToStaticMarkup(createElement(Loading))).not.toThrow();
  });

  it("announces itself to screen readers as a busy status, in Arabic", () => {
    const markup = at(NOON);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(new RegExp(`<span class="sr-only">${AR["common.loading"]}</span>`));
  });

  it("shows ONE usage tip, in a labelled card", () => {
    const markup = at(NOON);
    const shown = TIP_KEYS.filter((key) => markup.includes(AR[key] as string));
    expect(shown).toHaveLength(1);
    expect(textOf(markup)).toContain(AR["tips.heading"] as string);
  });

  // WP-ARABIC2 (d): the loading fallback is painted before the page knows who is looking, so it uses the
  // safest list — "everyone" — and never promises a guest the chat or the library. Same pure function of
  // the clock, one list narrower.
  const tipAt = (ms: number) => tipForAudience(tipSeed(ms), "everyone");

  it("the tip is chosen from the clock, by tipForAudience(tipSeed(now), \"everyone\"): the same moment always shows the same tip", () => {
    const expected = AR[tipAt(NOON)] as string;
    expect(at(NOON)).toContain(expected);
    expect(at(NOON)).toBe(at(NOON + 1000));
    expect(at(NOON + TIP_ROTATION_MS)).toContain(AR[tipAt(NOON + TIP_ROTATION_MS)] as string);
    expect(at(NOON + TIP_ROTATION_MS)).not.toContain(expected);
  });

  it("never shows a guest a tip about a feature the server refuses them", () => {
    const shown = new Set<string>();
    for (let i = 0; i < TIP_ROTATION_MS * TIP_KEYS.length; i += TIP_ROTATION_MS) shown.add(tipAt(NOON + i));
    expect(shown.has("tips.chat")).toBe(false);
    expect(shown.has("tips.files")).toBe(false);
    // every other key still gets its turn: narrowing the list must not swallow tips
    expect(shown.size).toBe(TIP_KEYS.length - 2);
  });

  it("never rolls a die while rendering (a random pick differs between the server and the browser)", () => {
    const random = vi.spyOn(Math, "random");
    at(NOON);
    expect(random).not.toHaveBeenCalled();
  });

  it("draws a calm skeleton: pulsing blocks that hold still under reduced motion, from the theme tokens", () => {
    const markup = at(NOON);
    expect((markup.match(/animate-pulse/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(markup).toContain("motion-reduce:animate-none");
    expect(markup).toContain("bg-muted/25");
    // the skeleton is decoration: only the status text and the tip are read out
    expect((markup.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("fits a phone: full width with 16px side padding (24px from md), and nothing wider than its container", () => {
    const classes = classesOf(at(NOON), /<div[^>]*role="status"[^>]*>/);
    expect(classes).toEqual(expect.arrayContaining(["w-full", "p-4", "md:p-6", "min-w-0"]));
  });

  it("the visible text is Arabic only", () => {
    expect(textOf(at(NOON))).not.toMatch(/[A-Za-z]/);
  });
});
