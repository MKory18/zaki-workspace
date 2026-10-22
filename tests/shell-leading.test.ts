import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A truncated Arabic label with `leading-none` clips its descenders (ى, ة) and stacked marks — the
 * word «المشاريع» loses its dots at the bottom. WP-UI2 item 2 fixed the bottom bar's labels, and
 * this guard keeps every shell part from pairing the two again.
 */
const SHELL_FILES = [
  "src/components/shell/bottom-nav.tsx",
  "src/components/shell/sidebar.tsx",
  "src/components/shell/space-switcher.tsx",
  "src/components/shell/avatar-menu.tsx",
  "src/components/notification-bell.tsx",
  "src/components/app-shell.tsx",
];

describe("no truncated label is squashed with leading-none in the shell", () => {
  it("leading-none never shares an element with truncate in the shell parts", () => {
    for (const rel of SHELL_FILES) {
      const source = readFileSync(path.resolve(__dirname, "..", rel), "utf8");
      // each JSX element: an opening tag that carries both classes
      for (const m of source.matchAll(/className=\{?[`"']([^`"'{}]+)[`"']/g)) {
        const cls = m[1] ?? "";
        expect(
          !(cls.includes("leading-none") && cls.includes("truncate")),
          `${rel}: leading-none beside truncate clips Arabic descenders: "${cls}"`,
        ).toBe(true);
      }
    }
  });

  it("the bottom bar's label line is NOT leading-none (the item-2 fix stays in)", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "src/components/shell/bottom-nav.tsx"), "utf8");
    expect(source).not.toMatch(/leading-none/);
  });
});
