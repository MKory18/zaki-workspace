import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// the dialogs open the new chat inside the app (router.push): rendered on its own, the page has no app router
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/chat",
}));

(globalThis as { React?: typeof React }).React = React;

import { ChatHome } from "@/components/chat/home/chat-home";
import { ChatComposer } from "@/components/chat/composer/chat-composer";
import { ConversationScreen } from "@/components/chat/conversation/conversation-screen";
import { MessageItem } from "@/components/chat/message/message-item";
import { I18nProvider } from "@/lib/i18n";
import type { ConversationDto, HomeDto, MessageDto } from "@/server/chat/dto";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const withI18n = (element: React.ReactElement) =>
  renderToStaticMarkup(createElement(Translations, { initial: "ar" }, element));

const noop = () => undefined;

/**
 * The phone contract (the owner, 2026-10-29: «شكل الموقع متناسق بالهاتف وشكل الدردشة متناسقة»):
 * the narrow screen keeps ONE scroll area, tighter gutters, text that wraps inside its bubble, and a
 * composer whose input shrinks while its buttons stay 44px. Nothing here changes behaviour: the same
 * messages, the same menu, the same actions.
 */
describe("mobile chat layout", () => {
  const message: MessageDto = {
    id: "m1",
    kind: "TEXT",
    body: "رابط طويل بلا مسافات: https://example.test/very/long/path/that/must/not/widen/the/viewport/on/a/phone",
    deleted: false,
    edited: false,
    pinned: false,
    mine: true,
    authorId: "u1",
    authorName: "ليلى",
    createdAt: "2026-01-01T00:00:00Z",
    mentions: [],
    attachments: [],
    reactions: [],
    replyTo: null,
  };

  it("keeps one scroll area in the conversation, with a tighter phone gutter", () => {
    const html = withI18n(createElement(ConversationScreen, { conversationId: "c1", onBack: noop }));
    const log = /<div[^>]*role="log"[^>]*>/.exec(html)?.[0] ?? "";
    expect(log).toContain("overflow-y-auto");
    expect(log).toContain("min-h-0");
    expect(log).toContain("overscroll-contain");
    expect(log).toContain("px-2.5");
    expect(log).toContain("md:p-3");
    // the conversation frame itself never grows past the shell
    expect(html).toContain("min-h-0");
  });

  it("wraps a long message inside its bubble and marks my own bubble with the accent", () => {
    const mine = renderToStaticMarkup(createElement(MessageItem, { message, canModerate: false, onReact: noop, onAction: noop }));
    const article = /<article[^>]*>/.exec(mine)?.[0] ?? "";
    expect(article).toContain("break-words");
    expect(article).toContain("min-w-0");
    expect(article).toContain("bg-accent/10");
    const other = renderToStaticMarkup(createElement(MessageItem, { message: { ...message, mine: false }, canModerate: false, onReact: noop, onAction: noop }));
    expect(/<article[^>]*>/.exec(other)?.[0] ?? "").not.toContain("bg-accent/10");
  });

  it("puts my messages and the others' on opposite sides of the log", () => {
    const mine = renderToStaticMarkup(createElement(MessageItem, { message, canModerate: false, onReact: noop, onAction: noop }));
    const other = renderToStaticMarkup(createElement(MessageItem, { message: { ...message, mine: false }, canModerate: false, onReact: noop, onAction: noop }));
    // the log is RTL: a plain row starts at the right, a reversed row starts at the left
    expect(mine).toContain("flex-row-reverse");
    expect(other).toContain("flex-row");
    expect(other).not.toContain("flex-row-reverse");
  });

  it("lets the composer's input shrink while its buttons keep their 44px target", () => {
    const detail = {
      id: "c1",
      kind: "DM",
      title: "سلمى",
      members: [],
      me: { id: "u1", canPost: true },
    } as unknown as ConversationDto;
    const html = withI18n(createElement(ChatComposer, { conversationId: "c1", detail, reply: null, onMessage: noop, onCancelReply: noop }));
    const row = /<div class="[^"]*items-end[^"]*">/.exec(html)?.[0] ?? "";
    expect(row).toContain("min-w-0");
    const textarea = /<textarea[^>]*>/.exec(html)?.[0] ?? "";
    expect(textarea).toContain("min-w-0");
    expect(textarea).toContain("min-h-11");
    expect(html).toContain("h-11 w-11");
  });

  it("keeps the phone's top bar two rows: the space's name folds away on the narrowest screens", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "src/components/shell/top-bar.tsx"), "utf8");
    // the actions and the search are the two rows; a name that does not fit must not push a third one
    expect(source).toContain("max-[379px]:hidden");
    expect(source).toContain("gap-x-1 gap-y-1 px-1.5");
  });

  it("gives the chat list a phone gutter and a card that steps up on a computer", () => {
    const home = {
      canOversee: false,
      spaces: [
        {
          id: "s",
          name: "مساحة",
          emoji: "🌿",
          kind: "STANDARD",
          hasExternal: false,
          canModerate: false,
          canCreateTopic: false,
          sections: [],
          unread: 0,
          topics: [],
        },
      ],
      dms: [],
    } as unknown as HomeDto;
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home }));
    expect(/<div dir="rtl"[^>]*>/.exec(html)?.[0] ?? "").toContain("p-3");
    expect(html).toContain("sm:p-4");
    expect(html).toContain("min-w-0");
  });
});
