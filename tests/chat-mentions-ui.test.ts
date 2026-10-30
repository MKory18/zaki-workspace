import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

import { MessageItem } from "../src/components/chat/message/message-item";
import type { MessageDto } from "../src/server/chat/dto";

const base: MessageDto = { id: "m1", kind: "TEXT", body: "أهلا @سارة شوفي هاد", deleted: false, edited: false, pinned: false, mine: false, authorId: "u1", authorName: "ليلى", createdAt: "2026-01-01T00:00:00Z", mentions: ["me"], attachments: [], reactions: [], replyTo: null };
const noop = () => undefined;
const render = (message: MessageDto, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(MessageItem, { message, canModerate: false, onReact: noop, onAction: noop, ...extra }));

describe("a mention in a message (the owner, 2026-10-30: like a messenger)", () => {
  it("draws the mentioned name highlighted, in both shapes of the log", () => {
    for (const classic of [false, true]) {
      const html = render(base, { mentionNames: ["سارة", "الكل"], classic });
      expect(html).toContain("data-mention");
      expect(html).toContain("@سارة");
    }
  });

  it("marks a message that mentions ME, by name or by «@الكل», and nobody else's", () => {
    expect(render(base, { meId: "me", mentionNames: ["سارة"] })).toContain("data-mentions-me");
    expect(render({ ...base, mentions: ["*"] }, { meId: "anyone", mentionNames: ["سارة"] })).toContain("data-mentions-me");
    expect(render(base, { meId: "someone-else", mentionNames: ["سارة"] })).not.toContain("data-mentions-me");
  });

  it("my own message and a deleted one are never marked", () => {
    expect(render({ ...base, mine: true }, { meId: "me" })).not.toContain("data-mentions-me");
    expect(render({ ...base, deleted: true, body: null }, { meId: "me" })).not.toContain("data-mentions-me");
  });

  it("without the names the body is plain text, as before", () => {
    expect(render(base)).not.toContain("data-mention");
  });
});
