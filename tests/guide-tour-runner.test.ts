import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { TourRunner, findHookElement, hasSeenTour, startTour, stopTour } from "@/components/guide/tour-runner";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";

const t = (key: string) => AR[key] ?? key;
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;

interface FakeEl {
  name: string;
  w: number;
  h: number;
  display?: string;
  visibility?: string;
}

/** A page with these elements under these selectors; each answers getBoundingClientRect like a real one. */
function fakePage(bySelector: Record<string, FakeEl[]>) {
  vi.stubGlobal("getComputedStyle", (el: FakeEl) => ({ display: el.display ?? "block", visibility: el.visibility ?? "visible" }));
  return {
    querySelectorAll: (selector: string) =>
      (bySelector[selector] ?? []).map((el) => Object.assign(el, { getBoundingClientRect: () => ({ width: el.w, height: el.h }) })),
  } as unknown as ParentNode;
}

afterEach(() => vi.unstubAllGlobals());

describe("findHookElement: the element a hook points at", () => {
  it("looks the hook up by its data-tour attribute", () => {
    const asked: string[] = [];
    const root = { querySelectorAll: (selector: string) => (asked.push(selector), []) } as unknown as ParentNode;
    expect(findHookElement("places", root)).toBeNull();
    expect(asked).toEqual(['[data-tour="places"]']);
  });

  it("with two elements on one hook (a side menu and a bottom bar) points at the one that is shown", () => {
    const sideMenu: FakeEl = { name: "side menu", w: 0, h: 0, display: "none" };
    const bottomBar: FakeEl = { name: "bottom bar", w: 375, h: 64 };
    const root = fakePage({ '[data-tour="places"]': [sideMenu, bottomBar] });
    expect((findHookElement("places", root) as unknown as FakeEl).name).toBe("bottom bar");
  });

  it("an element with no size, display none or hidden visibility is not 'on the page'", () => {
    expect(findHookElement("tabs", fakePage({ '[data-tour="tabs"]': [{ name: "a", w: 0, h: 0 }] }))).toBeNull();
    expect(findHookElement("tabs", fakePage({ '[data-tour="tabs"]': [{ name: "b", w: 100, h: 40, display: "none" }] }))).toBeNull();
    expect(findHookElement("tabs", fakePage({ '[data-tour="tabs"]': [{ name: "c", w: 100, h: 40, visibility: "hidden" }] }))).toBeNull();
    expect(findHookElement("tabs", fakePage({ '[data-tour="tabs"]': [] }))).toBeNull();
  });

  it("takes the first shown one when several are", () => {
    const root = fakePage({ '[data-tour="search"]': [{ name: "first", w: 200, h: 40 }, { name: "second", w: 200, h: 40 }] });
    expect((findHookElement("search", root) as unknown as FakeEl).name).toBe("first");
  });
});

describe("startTour", () => {
  it("does nothing on the server (no document) and says so", async () => {
    expect(await startTour("shell", t)).toBe(false);
  });

  it("does not start, and says so, when none of the tour's elements is on the page", async () => {
    vi.stubGlobal("document", fakePage({}));
    expect(await startTour("shell", t)).toBe(false);
    expect(await startTour("today", t)).toBe(false);
  });
});

describe("stopTour", () => {
  it("is harmless when no tour is running", () => {
    expect(() => stopTour()).not.toThrow();
  });
});

describe("remembering a tour", () => {
  it("a device with no storage (the server) has seen nothing", () => {
    expect(hasSeenTour("shell")).toBe(false);
    expect(hasSeenTour("today")).toBe(false);
  });
});

describe("TourRunner", () => {
  it("draws nothing (it only starts a tour, and only when asked to)", () => {
    const html = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(TourRunner, { tour: "today", auto: true })));
    expect(html).toBe("");
  });
});
