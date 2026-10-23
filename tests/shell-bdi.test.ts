import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

/**
 * A person's name or a space's name can be Latin inside the Arabic interface. Bare in an RTL line
 * the Latin run breaks out of its slot (a trailing «(أحمد» turns into «(Ahmad» and the punctuation
 * jumps sides). `<bdi>` isolates the run: the name keeps its own direction wherever it is written.
 * WP-UI2 item 4 wrapped the user-driven names in the shell parts.
 */
describe("names in the shell are directionally isolated (<bdi>)", () => {
  it("the avatar menu isolates the person's name (both the row and the menu header)", () => {
    const src = read("src/components/shell/avatar-menu.tsx");
    expect(src.match(/<bdi>\{user\.name\}<\/bdi>/g)?.length).toBe(2);
  });

  it("the space switcher isolates each space's name", () => {
    expect(read("src/components/shell/space-switcher.tsx")).toContain("<bdi>{space.name}</bdi>");
  });

  it("the notification bell isolates each notification's title", () => {
    expect(read("src/components/notification-bell.tsx")).toContain("<bdi>{n.title}</bdi>");
  });
});
