import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

(globalThis as { React?: typeof React }).React = React;

import { MessageItem } from "../src/components/chat/message/message-item";
import { Avatar } from "../src/components/ui/avatar";
import { dayLabelOf, opensDay } from "../src/lib/chat/day-separator";
import type { MessageDto } from "../src/server/chat/dto";

/**
 * THE MODERN BUBBLE AND THE PROFILE PICTURE (the owner, 2026-10-29: «نظام دردشة نفس التطبيقات
 * الحديثة»، «فقاعة الرسالة مش كبيرة زيادة»، «خيار إن المستخدم يحط صورة بروفايل»).
 *
 * These pin the shape the screen promises: the author's picture and name sit outside a narrower
 * bubble, the time is a quiet corner line, my own messages take no picture, and a picture is drawn
 * only from our own `/api/avatars/…` address.
 */
const base: MessageDto = {
  id: "m1",
  kind: "TEXT",
  body: "نص الرسالة",
  deleted: false,
  edited: false,
  pinned: false,
  mine: false,
  authorId: "u1",
  authorName: "ليلى",
  createdAt: "2026-01-01T09:05:00Z",
  mentions: [],
  attachments: [],
  reactions: [],
};
const noop = () => undefined;
const render = (message: MessageDto, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(MessageItem, { message, canModerate: false, onReact: noop, onAction: noop, ...extra }));

describe("the bubble of a modern chat", () => {
  it("is narrower than half a phone's log, and tighter on a computer", () => {
    const article = /<article[^>]*>/.exec(render(base))?.[0] ?? "";
    expect(article).toContain("max-w-[85%]");
    expect(article).toContain("sm:max-w-[75%]");
    // the old wide bubble (85% on every screen) is gone
    expect(article).not.toContain("p-3 ");
  });

  it("keeps the corner nearest its author tight, on the right side of the log", () => {
    expect(/<article[^>]*>/.exec(render(base))?.[0] ?? "").toContain("rounded-es-md");
    expect(/<article[^>]*>/.exec(render({ ...base, mine: true }))?.[0] ?? "").toContain("rounded-ee-md");
  });

  it("says the time once, in the bubble's corner, and never the author's name for me", () => {
    const other = render(base);
    // the name is a line ABOVE the bubble, not inside it
    expect(other).toContain(">ليلى</p>");
    expect(other).toMatch(/<time[^>]*[dD]ate[tT]ime="2026-01-01T09:05:00Z"/);
    // mine: the bubble says nothing of a name
    const mine = render({ ...base, mine: true });
    expect(mine).not.toContain(">ليلى</p>");
    expect(mine).toMatch(/<time[^>]*[dD]ate[tT]ime=/);
  });

  it("draws the author's picture beside their bubble, and none beside mine", () => {
    const withPicture = render({ ...base, authorAvatar: "/api/avatars/f1" });
    expect(withPicture).toContain('src="/api/avatars/f1"');
    // my own message never carries my own face back at me
    expect(render({ ...base, mine: true, authorAvatar: "/api/avatars/f1" })).not.toContain("/api/avatars/f1");
    // no picture: the initials
    expect(render(base)).toContain(">ل<");
  });

  it("refuses a picture that is not ours (a remote URL draws the initials instead)", () => {
    const html = render({ ...base, authorAvatar: "https://tracker.example/face.png" });
    expect(html).not.toContain("tracker.example");
    expect(html).toContain(">ل<");
  });

  it("a reply quote is a quiet block inside the bubble, and the ticks keep their word for a screen reader", () => {
    const html = render({ ...base, mine: true, status: "read", replyTo: { id: "p1", preview: "رسالة سابقة", authorName: "سلمى" } });
    expect(html).toContain("<blockquote");
    expect(html).toContain("رسالة سابقة");
    expect(html).toContain('data-ticks="read"');
    expect(html).toContain("قُرئت");
  });
});

describe("the avatar", () => {
  it("draws our own picture when it has one, and the initials otherwise", () => {
    const picture = renderToStaticMarkup(React.createElement(Avatar, { name: "سلمى عبيد", src: "/api/avatars/f9", className: "size-9" }));
    expect(picture).toContain('src="/api/avatars/f9"');
    expect(picture).toContain("object-cover");
    const initials = renderToStaticMarkup(React.createElement(Avatar, { name: "سلمى عبيد" }));
    expect(initials).toContain("سع");
    expect(initials).not.toContain("<img");
  });
});

describe("the day separator", () => {
  const now = new Date(2026, 9, 29, 12, 0, 0); // 29 تشرين الأول 2026

  it("says today, yesterday, or the long date — in Arabic", () => {
    expect(dayLabelOf(new Date(2026, 9, 29, 8, 0), now)).toBe("اليوم");
    expect(dayLabelOf(new Date(2026, 9, 28, 23, 0), now)).toBe("أمس");
    expect(dayLabelOf(new Date(2026, 9, 20, 10, 0), now)).toBe("الثلاثاء 20 تشرين الأول 2026");
  });

  it("opens a new day at the first message and whenever the day changes", () => {
    expect(opensDay("2026-10-29T08:00:00Z", null)).toBe(true);
    expect(opensDay("2026-10-29T09:00:00Z", "2026-10-29T08:00:00Z")).toBe(false);
    expect(opensDay("2026-10-30T09:00:00Z", "2026-10-29T23:00:00Z")).toBe(true);
  });

  it("the conversation draws it between days, not before every message", () => {
    const screen = readFileSync(path.resolve(__dirname, "..", "src/components/chat/conversation/conversation-screen.tsx"), "utf8");
    expect(screen).toContain("data-day-separator");
    expect(screen).toContain("opensDay(");
    expect(screen).toContain("dayLabelOf(");
  });
});
