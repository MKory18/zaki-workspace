import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(__dirname, "..", "src/components/notification-bell.tsx"), "utf8");

/**
 * WP-UI2 item 9. A phone "taps" the bell, and the tap sticks: the hover background stayed on after
 * the panel closed, looking like a broken pressed state. The hover background now only applies
 * where the device really hovers (@media(hover:hover)), and keyboard focus draws an inset ring —
 * inside the round button, not a rectangle hanging outside it.
 */
describe("the notification bell's hover and focus (item 9)", () => {
  it("the hover background is gated on a device that really hovers", () => {
    expect(source).toMatch(/@media\(hover:hover\)/);
    // and plain hover is not left to stick on touch: the desktop hover is the gated one
    expect(source).toMatch(/md:hover:\[@media\(hover:hover\)\]:bg-surface-2/);
  });

  it("keyboard focus draws a ring inside the round button", () => {
    expect(source).toMatch(/focus-visible:ring-2/);
    expect(source).toMatch(/focus-visible:ring-inset/);
    expect(source).toMatch(/focus-visible:ring-accent\//);
  });
});
