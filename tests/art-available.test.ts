import * as React from "react";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { ArtSlot } from "@/components/theme/art-slot";
import { ART_AVAILABLE, ART_SLOTS, artUrl, isArtSlot } from "@/lib/themes/decor";

const Host = ({ children }: { children?: ReactNode }) => createElement("div", null, children) as ReactElement;

/**
 * The owner's artwork has not been dropped in yet (`ART_AVAILABLE` is empty).
 *
 * The slot is STILL rendered: the names in `ART_SLOTS` are the contract with the owner, and the
 * pages (today, the empty lists, the guide) assert where the slot sits. What keeps a missing file
 * from ever being seen is the component's own rule — a failed load removes itself (`state ===
 * "failed"` from onError, and `artStateOf` catches a failure that happened before React attached
 * the listener). An unknown name renders nothing at all, so a typo never leaks into a URL.
 *
 * (Contract settled in the Wave 3 close-out: the earlier "render nothing while ART_AVAILABLE is
 * empty" reading contradicted the page-level contracts in tests/db/today-page and
 * tests/db/guide-pages, and hid the slot from the server HTML entirely.)
 */
describe("no artwork has shipped yet", () => {
  it("ART_AVAILABLE is empty (and every agreed slot is still a slot)", () => {
    expect(ART_AVAILABLE).toEqual([]);
    expect(ART_SLOTS.length).toBe(12);
    for (const s of ART_SLOTS) expect(isArtSlot(s)).toBe(true);
  });

  it("an agreed slot with no shipped file renders NOTHING (not even an <img> to fail)", () => {
    for (const slot of ["today-strip", "login-door", "empty-tasks", "guide-welcome"]) {
      const out = renderToStaticMarkup(createElement(Host, null, createElement(ArtSlot, { slot, className: "max-h-44" })));
      expect(out, slot).toBe("<div></div>");
    }
    // but the names themselves are still the contract: the URL derivation stays well-formed
    expect(artUrl("today-strip")).toBe("/brand/art/today-strip.webp");
  });

  it("a name that is not an agreed slot renders NOTHING — never a broken <img> in the page", () => {
    for (const slot of ["not-a-slot", "", "../etc/passwd"]) {
      const out = renderToStaticMarkup(createElement(Host, null, createElement(ArtSlot, { slot })));
      expect(out, slot).toBe("<div></div>");
    }
  });
});
