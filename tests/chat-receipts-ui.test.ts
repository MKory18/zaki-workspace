import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageItem } from "../src/components/chat/message/message-item";
import { systemSentence, systemSentenceOfBody } from "../src/lib/chat/system-sentence";
import type { MessageDto } from "../src/server/chat/dto";

const base: MessageDto = { id: "m1", kind: "TEXT", body: "نص", deleted: false, edited: false, pinned: false, mine: true, authorId: "u1", authorName: "ليلى", createdAt: "2026-01-01T00:00:00Z", mentions: [], attachments: [], reactions: [] };
const noop = () => undefined;
const render = (message: MessageDto, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(MessageItem, { message, canModerate: false, onReply: noop, onReact: noop, onPin: noop, onEdit: noop, onDelete: noop, ...extra }));

describe("DM ticks on my own message", () => {
  it("✓ sent and ✓✓ delivered are muted; ✓✓ read is in the info colour; each says its word to a screen reader", () => {
    const sent = render({ ...base, status: "sent" });
    expect(sent).toContain('data-ticks="sent"');
    expect(sent).toContain("✓</span>");
    expect(sent).toContain("أُرسلت");
    expect(sent).toContain("text-fg-muted");

    const deliveredHtml = render({ ...base, status: "delivered" });
    expect(deliveredHtml).toContain("✓✓");
    expect(deliveredHtml).toContain("وصلت");
    expect(deliveredHtml).not.toContain("text-info");

    const readHtml = render({ ...base, status: "read" });
    expect(readHtml).toContain("text-info");
    expect(readHtml).toContain("قُرئت");
  });

  it("nobody else's message, and no deleted message, carries ticks", () => {
    expect(render({ ...base, mine: false, status: "read" })).not.toContain("data-ticks");
    expect(render({ ...base, deleted: true, body: null, status: "read" })).not.toContain("data-ticks");
  });
});

describe("reader avatars", () => {
  it("up to five avatars and «+n», named for screen readers", () => {
    const readers = ["أ", "ب", "ج", "د", "ه", "و", "ز"].map((name, i) => ({ userId: `u${i}`, name, messageId: "m1" }));
    const html = render({ ...base, mine: false }, { readers });
    expect(html).toContain("data-readers");
    expect(html).toContain("+2");
    expect(html).toContain("قرأها: أ، ب، ج، د، ه و2 آخرون");
  });

  it("no row without readers", () => {
    expect(render(base)).not.toContain("data-readers");
  });
});

describe("system lines", () => {
  it("render as a quiet sentence, never a bubble with actions or raw JSON", () => {
    const html = render({ ...base, kind: "SYSTEM", body: null, mine: false, authorName: "سارة", system: { k: "pin", p: {} } });
    expect(html).toContain("تثبيت رسالة بواسطة سارة");
    expect(html).not.toContain("<article");
    expect(html).not.toContain("رد على الرسالة");
  });

  it("an unknown or unparsable line reads as a neutral update", () => {
    expect(systemSentence({ k: "something_new" }, "سارة")).toBe("تحديث في المحادثة");
    expect(systemSentenceOfBody("not json", "سارة")).toBe("تحديث في المحادثة");
    expect(systemSentenceOfBody(JSON.stringify({ k: "join", p: {} }), "سارة")).toBe("انضمام سارة إلى المحادثة");
  });
});

describe("the chat bubble's colours come from the theme", () => {
  it("no class name that is not a theme token (text-muted-foreground, bg-background drew nothing)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["src/components/chat/message/message-item.tsx", "src/components/chat/message/voice-player.tsx", "src/components/chat/conversation/conversation-screen.tsx", "src/components/chat/composer/chat-composer.tsx"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/muted-foreground|bg-background|text-foreground|bg-primary/);
    }
  });
});
