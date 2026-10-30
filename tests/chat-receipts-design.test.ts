import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

import { MessageItem, ReaderList, TypingLine } from "../src/components/chat/message/message-item";
import { runFlags, GROUP_GAP_MS } from "../src/lib/chat/group";
import type { MessageDto } from "../src/server/chat/dto";

const base: MessageDto = { id: "m1", kind: "TEXT", body: "نص", deleted: false, edited: false, pinned: false, mine: false, authorId: "u1", authorName: "ليلى", createdAt: "2026-01-01T10:00:00Z", mentions: [], attachments: [], reactions: [] };
const noop = () => undefined;
const render = (message: MessageDto, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(MessageItem, { message, canModerate: false, onReact: noop, onAction: noop, ...extra }));

describe("consecutive messages of one person form a run (Telegram / Messenger look)", () => {
  const at = (minutes: number, day = "2026-01-01") => new Date(Date.parse(`${day}T10:00:00Z`) + minutes * 60_000).toISOString();
  const m = (id: string, authorId: string, createdAt: string, kind = "TEXT") => ({ id, authorId, createdAt, kind });

  it("the first of a run shows the name, the last shows the picture and the tail", () => {
    const list = [m("a", "u1", at(0)), m("b", "u1", at(1)), m("c", "u1", at(2))];
    expect([0, 1, 2].map((i) => runFlags(list, i))).toEqual([
      { start: true, end: false },
      { start: false, end: false },
      { start: false, end: true },
    ]);
  });

  it("another person, a system line, a new day or a long pause ends the run", () => {
    expect(runFlags([m("a", "u1", at(0)), m("b", "u2", at(1))], 0).end).toBe(true);
    expect(runFlags([m("a", "u1", at(0)), m("b", "u2", at(1))], 1).start).toBe(true);
    expect(runFlags([m("a", "u1", at(0)), m("s", "u1", at(1), "SYSTEM"), m("b", "u1", at(2))], 2).start).toBe(true);
    expect(runFlags([m("a", "u1", at(0)), m("b", "u1", at(0, "2026-01-02"))], 1).start).toBe(true);
    expect(runFlags([m("a", "u1", at(0)), m("b", "u1", at(GROUP_GAP_MS / 60_000 + 1))], 1).start).toBe(true);
  });

  it("a lone message is both the first and the last", () => {
    expect(runFlags([m("a", "u1", at(0))], 0)).toEqual({ start: true, end: true });
  });

  it("inside a run the bubble shows no name and no picture; at its ends it does", () => {
    const middle = render(base, { groupStart: false, groupEnd: false });
    expect(middle).not.toContain("ليلى");
    expect(middle).toContain("data-run=\"middle\"");
    const first = render(base, { groupStart: true, groupEnd: false });
    expect(first).toContain("ليلى");
    const last = render(base, { groupStart: false, groupEnd: true });
    expect(last).toContain("data-run=\"end\"");
  });

  it("with no run information the message looks as before (name and picture)", () => {
    expect(render(base)).toContain("ليلى");
  });
});

describe("reader avatars say who read and when (the owner's spec: tap for who and when)", () => {
  const readers = [
    { userId: "u2", name: "سارة", messageId: "m1", readAt: "2026-01-01T10:05:00Z" },
    { userId: "u3", name: "خالد", messageId: "m1", readAt: "2026-01-01T10:09:00Z" },
  ];

  it("the row is a button that opens a list, closed at first", () => {
    const html = render({ ...base, mine: true }, { readers });
    expect(html).toContain("data-readers");
    expect(html).toContain('aria-expanded="false"');
  });

  it("the list names every reader with the time, with no five-person cap", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ userId: `x${i}`, name: `شخص${i}`, messageId: "m1", readAt: "2026-01-01T10:05:00Z" }));
    const html = renderToStaticMarkup(React.createElement(ReaderList, { readers: many }));
    for (let i = 0; i < 8; i += 1) expect(html).toContain(`شخص${i}`);
    expect(html).toContain("<time");
  });
});

describe("«يكتب…»", () => {
  it("names one, two or several people, and renders nothing for nobody", () => {
    expect(renderToStaticMarkup(React.createElement(TypingLine, { names: [] }))).toBe("");
    expect(renderToStaticMarkup(React.createElement(TypingLine, { names: ["سارة"] }))).toContain("سارة يكتب…");
    expect(renderToStaticMarkup(React.createElement(TypingLine, { names: ["سارة", "خالد"] }))).toContain("سارة وخالد يكتبان…");
    expect(renderToStaticMarkup(React.createElement(TypingLine, { names: ["أ", "ب", "ج"] }))).toContain("يكتبون…");
  });
});
