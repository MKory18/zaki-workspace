import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WP-UI1 · phone-first defaults for the shared form primitives (review B item 1).
 *
 * iPhone Safari zooms the page when a focused field is smaller than 16px, and a tap target below
 * 44px is too small for a thumb. So the DEFAULTS must be phone-first (`h-11 text-base`) and only
 * from `md` up the desktop sizes (`h-9 text-sm`). Call sites that need smaller pass their own
 * classes; the defaults are what the brief pins here.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "");

describe("phone-first defaults in the shared primitives", () => {
  it("Input is h-11 text-base on a phone, h-9 text-sm from md", () => {
    const s = read("src/components/ui/input.tsx");
    expect(s).toMatch(/h-11 w-full[\s\S]*?text-base[\s\S]*?md:h-9[\s\S]*?md:text-sm/);
    expect(s).not.toMatch(/"h-9 w-full/);
  });

  it("Select is h-11 text-base on a phone, h-9 text-sm from md", () => {
    const s = read("src/components/ui/select.tsx");
    expect(s).toMatch(/h-11 w-full[\s\S]*?text-base[\s\S]*?md:h-9[\s\S]*?md:text-sm/);
  });

  it("Textarea is text-base on a phone, text-sm from md", () => {
    const s = read("src/components/ui/textarea.tsx");
    expect(s).toMatch(/text-base[\s\S]*?md:text-sm/);
  });

  it("Button: sm h-10 md:h-8 · md h-11 md:h-9 · icon size-11 md:size-8", () => {
    const s = read("src/components/ui/button.tsx");
    expect(s).toMatch(/sm:\s*"h-10 md:h-8/);
    expect(s).toMatch(/md:\s*"h-11 md:h-9/);
    expect(s).toMatch(/icon:\s*"size-11 md:size-8/);
  });
});
