import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatHome } from "@/components/chat/home/chat-home";

describe("chat home audience sections", () => {
  const topic = (id: string, title: string, teamId: string | null = null) => ({ id, title, emoji: "💬", topicType: "DISCUSSION" as const, unread: 0, mentions: 0, closed: false, restricted: false, teamId, canPost: true, lastMessage: null });
  const space = (over: Record<string, unknown> = {}) => ({ id: "s", name: "مساحة", emoji: "🌿", kind: "STANDARD", hasExternal: true, canModerate: false, canCreateTopic: false, sections: [], unread: 0, topics: [topic("t", "عام")], ...over });

  it("shows the space you are in with its topics to guests, without a private section", () => {
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: true, home: { canOversee: false, spaces: [space()], dms: [] } }));
    expect(html).toContain("<bdi>مساحة</bdi>");
    expect(html).toContain("عام");
    expect(html).not.toContain("خاص");
    expect(html).not.toContain("موضوع جديد"); // only the space's ADMIN and the OWNER open topics
  });

  it("groups the topics like a forum group: the space's own first, then each «مقطع» under its name", () => {
    const home = space({
      canCreateTopic: true,
      sections: [{ id: "x", name: "التصميم" }, { id: "y", name: "الشحن" }],
      topics: [topic("t1", "عام"), topic("t2", "شغل التصميم", "x")],
    });
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: false, spaces: [home], dms: [] } }));
    expect(html.indexOf("عام")).toBeLessThan(html.indexOf("مقطع التصميم"));
    expect(html.indexOf("مقطع التصميم")).toBeLessThan(html.indexOf("شغل التصميم"));
    expect(html).toContain("مقطع الشحن");
    expect(html).toContain("ما في مواضيع بهالمقطع لسا.");
    expect(html).toMatch(/<button[^>]*>موضوع جديد<\/button>/);
  });
  it("«رسالة جديدة» is a button that opens the people picker, not a link the page ignores", () => {
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: false, spaces: [], dms: [] } }));
    expect(html).toMatch(/<button[^>]*>رسالة جديدة<\/button>/);
    expect(html).not.toContain("new=dm");
  });
  it("«افتح مساحة» never links to the missing /workspaces page, and waits for the server's answer", () => {
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: false, spaces: [], dms: [] } }));
    expect(html).not.toContain("href=\"/workspaces\"");
    // before /api/workspaces says the person may open a space, there is no button at all
    expect(html).not.toContain("افتح مساحة");
  });
  it("shows the owner oversight switch", () => {
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: true, spaces: [], dms: [] } }));
    expect(html).toContain("كل الشركة");
    expect(html).toContain("محادثاتي");
  });
});
