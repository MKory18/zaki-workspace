import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(__dirname, "..", "src/components/guide/page-help-button.tsx"), "utf8");

/**
 * WP-UI2 item 11: the help sheet is a hand-rolled dialog, so two things the shared Sheet gives for
 * free were missing — the page behind it scrolled under the backdrop, and when a tour ended
 * driver.js left the focus on `body`. The fix keeps the hand-rolled panel but adds the scroll lock
 * and re-focuses the trigger before the tour starts.
 */
describe("the help sheet locks the page and never loses focus (item 11)", () => {
  it("while it is open the body cannot scroll; closing gives the scroll back", () => {
    expect(source).toMatch(/document\.body\.style\.overflow = "hidden"/);
    // restored in the effect's cleanup, from the value it found
    expect(source).toMatch(/document\.body\.style\.overflow = previous/);
  });

  it("before the tour starts, the focus goes back to the «؟» button (driver.js will drop it on body)", () => {
    const tour = source.slice(source.indexOf("startTourNow"));
    expect(tour).toMatch(/triggerRef\.current\?\.focus\(\)/);
    // ...and it happens before startTour is awaited, not after
    expect(tour.indexOf("triggerRef.current?.focus()")).toBeLessThan(tour.indexOf("await startTour"));
  });

  it("closing the sheet by hand still returns focus to the trigger (unchanged behaviour)", () => {
    const close = source.slice(source.indexOf("const close ="), source.indexOf("const close =") + 200);
    expect(close).toMatch(/triggerRef\.current\?\.focus\(\)/);
  });
});
