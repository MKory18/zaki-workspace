import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { BottomNav } from "@/components/shell/bottom-nav";
import { I18nProvider } from "@/lib/i18n";
import { badgeText, MOVES_UNREAD } from "@/lib/chat/use-chat-unread";
import type { NavPlace } from "@/lib/nav/places";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const places = [
  { key: "today", href: "/", labelKey: "nav.place.today", icon: "today", requires: "everyone", tabs: [] },
  { key: "chat", href: "/chat", labelKey: "nav.place.chat", icon: "chat", requires: "everyone", tabs: [] },
] as unknown as NavPlace[];
const nav = (badges: Record<string, number>) =>
  renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(BottomNav, { places, current: null, pathname: "/", badges })));

describe("the unread badge on «الدردشة»", () => {
  it("nothing at 0, the number up to 9, then «9+» (the bell's rule)", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-1)).toBeNull();
    expect(badgeText(3)).toBe("3");
    expect(badgeText(9)).toBe("9");
    expect(badgeText(10)).toBe("9+");
  });

  it("sits on «الدردشة» only, as a pill for the eye and words for a screen reader", () => {
    const html = nav({ chat: 4 });
    expect((html.match(/data-badge/g) ?? []).length).toBe(1);
    expect(html).toContain(">4</span>");
    expect(html).toContain("4 رسالة غير مقروءة");
    const chatLink = html.slice(html.indexOf('href="/chat"'));
    expect(chatLink).toContain("data-badge");
  });

  it("no pill at all when nothing waits", () => {
    expect(nav({ chat: 0 })).not.toContain("data-badge");
    expect(nav({})).not.toContain("data-badge");
  });

  it("a new message, a read mark, a deletion or a door that moved refetches it at once", () => {
    for (const kind of ["message.created", "conversation.read", "message.deleted", "membership.changed", "conversation.changed"]) expect(MOVES_UNREAD.has(kind)).toBe(true);
    expect(MOVES_UNREAD.has("typing")).toBe(false);
    expect(MOVES_UNREAD.has("message.reacted")).toBe(false);
  });
});

describe("the badge after I read", () => {
  it("the screen announces a read mark, and the badge listens (the owner's silent read sends no live event)", async () => {
    const { announceChatRead, onChatRead } = await import("@/lib/chat/use-chat-unread");
    const target = new EventTarget();
    vi.stubGlobal("window", { addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) });
    const seen: number[] = [];
    const off = onChatRead(() => seen.push(1));
    announceChatRead();
    off();
    announceChatRead();
    expect(seen).toEqual([1]);
    vi.unstubAllGlobals();
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/components/chat/conversation/conversation-screen.tsx", "utf8")).toMatch(/\/read\?upTo=.*announceChatRead\(\)/);
  });
});
