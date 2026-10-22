import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

import { NotificationBell } from "@/components/notification-bell";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, classesOf, textOf } from "./ui-render";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

const NOW = Date.now();
const SAMPLE = {
  unreadCount: 12,
  items: [
    { id: "n1", type: "task.assigned", title: "مهمة جديدة لك", body: "راجع تصميم الصفحة", linkUrl: "/tasks/t1", readAt: null, createdAt: new Date(NOW - 5 * 60_000).toISOString() },
    { id: "n2", type: "mention", title: "ذكرك أحمد", body: null, linkUrl: null, readAt: new Date(NOW).toISOString(), createdAt: new Date(NOW - 3 * 3600_000).toISOString() },
  ],
};

function render(element: ReactElement, data: unknown = SAMPLE): string {
  const client = new QueryClient();
  if (data) client.setQueryData(["notifications"], data);
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, element)));
}

const closed = (data?: unknown) => render(createElement(NotificationBell), data);
const open = (data?: unknown) => render(createElement(NotificationBell, { defaultOpen: true }), data);

describe("the bell", () => {
  it("is the guide's «inbox» stop, a 44px button named in Arabic with the number of unread notifications", () => {
    const html = closed();
    expect(html).toContain('data-tour="inbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<button[^>]*class="[^"]*\bsize-11\b/);
    expect(html).toContain(`aria-label="${AR["shell.inbox_unread"]?.replace("{count}", "12")}"`);
    expect(html).toContain(">9+<");
  });

  it("with nothing unread: no badge, and the plain name", () => {
    const html = closed({ unreadCount: 0, items: [] });
    expect(html).toContain(`aria-label="${AR["notif.title"]}"`);
    expect(html).not.toContain("9+");
    expect(html).not.toContain("bg-danger");
  });

  it("the badge is the theme's danger colour with its own text colour (no palette red, no white)", () => {
    const html = closed();
    expect(html).toMatch(/class="[^"]*\bbg-danger\b[^"]*\btext-danger-fg\b/);
  });
});

describe("the panel", () => {
  it("fits a 375px phone: pinned 8px from both edges under the top bar, never wider than the screen", () => {
    const html = open();
    const panel = classesOf(html, /<section[^>]*>/);
    expect(panel).toEqual(expect.arrayContaining(["fixed", "start-2", "end-2", "max-w-[calc(100vw-1rem)]"]));
    expect(panel.some((c) => c.startsWith("top-[calc(3.5rem"))).toBe(true);
    // from md up it hangs under the bell
    expect(panel).toEqual(expect.arrayContaining(["md:absolute", "md:end-0", "md:start-auto", "md:w-80"]));
  });

  it("lists the notifications with their time in Arabic, the unread one marked", () => {
    const html = open();
    expect(html).toContain("مهمة جديدة لك");
    expect(html).toContain("راجع تصميم الصفحة");
    expect(html).toContain("ذكرك أحمد");
    expect(html).toContain("قبل 5 دقائق");
    expect(html).toContain("قبل 3 ساعات");
    expect(html).toContain('href="/tasks/t1"');
    expect(html).toContain(AR["notif.markAll"]);
    expect(html).toContain('aria-expanded="true"');
  });

  it("the actions of a row can be reached with a thumb: visible on a phone, 44px, named in Arabic", () => {
    const html = open();
    for (const label of [AR["notif.markRead"], AR["notif.delete"]]) expect(html).toContain(`aria-label="${label}"`);
    for (const [tag] of html.matchAll(/<button[^>]*aria-label="(?:تحديد كمقروء|حذف)"[^>]*>/g)) expect(tag).toMatch(/\bsize-11\b/);
    // the row's action group is not hidden on a phone (hover does not exist there)
    expect(html).not.toMatch(/class="(?![^"]*md:opacity-0)[^"]*\bopacity-0\b/);
  });

  it("says so when there is nothing", () => {
    expect(open({ unreadCount: 0, items: [] })).toContain(AR["notif.empty"]);
  });

  it("theme tokens only, logical CSS only, no English word on screen", () => {
    for (const html of [closed(), open(), open({ unreadCount: 0, items: [] })]) {
      const tokens = classTokens(html);
      expect(tokens.filter((c) => PALETTE_COLOUR.test(c))).toEqual([]);
      expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string))).toEqual([]);
      expect(textOf(html)).not.toMatch(/[A-Za-z]{2,}/);
    }
  });

  it("the source keeps no palette colour and no hard-coded one", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "src", "components", "notification-bell.tsx"), "utf8");
    expect(source).not.toMatch(PALETTE_COLOUR);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\btext-white\b/);
  });
});
