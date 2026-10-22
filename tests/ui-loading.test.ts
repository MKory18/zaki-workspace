import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Loading from "@/app/(app)/loading";
import { AR } from "@/lib/i18n/dict";
import { TIP_KEYS, TIP_ROTATION_MS, tipFor, tipSeed } from "@/lib/tips";
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

  it("the tip is chosen from the clock, by tipFor(tipSeed(now)): the same moment always shows the same tip", () => {
    const expected = AR[tipFor(tipSeed(NOON))] as string;
    expect(at(NOON)).toContain(expected);
    expect(at(NOON)).toBe(at(NOON + 1000));
    expect(at(NOON + TIP_ROTATION_MS)).toContain(AR[tipFor(tipSeed(NOON + TIP_ROTATION_MS))] as string);
    expect(at(NOON + TIP_ROTATION_MS)).not.toContain(expected);
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
