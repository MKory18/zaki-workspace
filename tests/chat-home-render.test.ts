import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatHome } from "@/components/chat/home/chat-home";

describe("chat home audience sections", () => {
  it("shows my spaces and topics to guests without a private section", () => {
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: true, home: { canOversee: false, spaces: [{ id: "s", name: "مساحة", emoji: "🌿", kind: "STANDARD", hasExternal: true, canModerate: false, unread: 0, topics: [{ id: "t", title: "عام", emoji: "💬", topicType: "DISCUSSION", unread: 0, mentions: 0, closed: false, restricted: false, canPost: true, lastMessage: null }] }], dms: [] } }));
    expect(html).toContain("مساحاتي");
    expect(html).toContain("عام");
    expect(html).not.toContain("خاص");
  });
  it("shows the owner oversight switch", () => {
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: true, spaces: [], dms: [] } }));
    expect(html).toContain("كل الشركة");
    expect(html).toContain("محادثاتي");
  });
});
