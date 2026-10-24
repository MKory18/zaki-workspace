import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

import { MessageItem } from "../src/components/chat/message/message-item";
import type { MessageDto } from "../src/server/chat/dto";

/**
 * The bubble after the single menu: no row of buttons under it any more (the old «رد / 👍 / تثبيت /
 * تعديل / حذف»), one «⋯» trigger where the person may act, nothing where they may not. What the menu
 * holds is tested against the server's rules in chat-message-menu.test.ts.
 */
const base: MessageDto = { id: "m1", kind: "TEXT", body: "نص الرسالة", deleted: false, edited: false, pinned: false, mine: true, authorId: "u1", authorName: "ليلى", createdAt: "2026-01-01T00:00:00Z", mentions: [], attachments: [], reactions: [], replyTo: { id: "p1", preview: "رسالة سابقة", authorName: "سلمى" } };
const noop = () => undefined;
const render = (message: MessageDto, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(MessageItem, { message, canModerate: false, onReact: noop, onAction: noop, ...extra }));

describe("MessageItem", () => {
  it("renders the reply context, and ONE menu trigger instead of five buttons", () => {
    const html = render(base);
    expect(html).toContain("رسالة سابقة");
    expect(html).toContain('aria-label="خيارات الرسالة"');
    for (const gone of ["رد على الرسالة", "تفاعل مع الرسالة", "تثبيت الرسالة", "تعديل الرسالة", "حذف الرسالة"]) expect(html).not.toContain(gone);
  });

  it("no menu on a deleted message, and none for the owner in silent oversight", () => {
    expect(render({ ...base, deleted: true, body: null })).not.toContain("خيارات الرسالة");
    expect(render({ ...base, mine: false }, { oversight: true })).not.toContain("خيارات الرسالة");
  });

  it("reaction chips toggle my own reaction and say which one is mine", () => {
    const html = render({ ...base, reactions: [{ emoji: "👍", count: 2, mine: true }, { emoji: "🔥", count: 1, mine: false }] } as MessageDto);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("تفاعل 👍، 2");
  });

  it("safely renders inline media with download links (oversight hides the menu, not the files)", () => {
    const message = { ...base, mine: false, attachments: [{ id: "a1", kind: "IMAGE" as const, name: "صورة.png", mime: "image/png", size: 10, url: "/api/chat/attachments/a1" }, { id: "a2", kind: "VIDEO" as const, name: "clip.mp4", mime: "video/mp4", size: 10, url: "/api/chat/attachments/a2" }, { id: "a3", kind: "AUDIO" as const, name: "voice.ogg", mime: "audio/ogg", size: 10, url: "/api/chat/attachments/a3" }] };
    const html = render(message, { canModerate: true, oversight: true });
    expect(html).not.toContain("خيارات الرسالة");
    for (const text of ["<img", "<video", "<audio", "download"]) expect(html).toContain(text);
  });
});
