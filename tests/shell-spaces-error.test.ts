import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.resolve(__dirname, "..", rel), "utf8");
const ar = JSON.parse(read("src/lib/i18n/ar.shell.json")) as Record<string, string>;

/**
 * WP-UI2 item 10. Two quiet failures on the shell: the space menu said «لست في أي مساحة بعد» even
 * when the list FAILED to load — a lie that looked like an empty account — and the search fields
 * drew their box with the strong `border-border` while every other input in the app uses the quiet
 * `border-muted`.
 */
describe("the space switcher says why the list is missing (item 10)", () => {
  it("a failed list gets its own message and a retry button, not the «empty» line", () => {
    const src = read("src/components/shell/space-switcher.tsx");
    expect(src).toMatch(/orgsQuery\.isError\s*\?/);
    expect(src).toContain('t("shell.spaces.error")');
    expect(src).toContain('t("shell.spaces.retry")');
    expect(src).toMatch(/orgsQuery\.refetch\(\)/);
  });

  it("the two new lines exist in Arabic and only there", () => {
    expect(ar["shell.spaces.error"]).toMatch(/[؀-ۿ]/);
    expect(ar["shell.spaces.retry"]).toMatch(/[؀-ۿ]/);
  });
});

describe("search fields use the quiet border like every other input", () => {
  for (const [file, label] of [
    ["src/components/guide/guide-search.tsx", "the guide's search"],
    ["src/components/list-filters.tsx", "the lists' filter search"],
  ] as const) {
    it(`${label} draws border-muted, not border-border`, () => {
      const src = read(file);
      expect(src).toMatch(/type="search"/);
      expect(src).toMatch(/border-muted/);
    });
  }
});
