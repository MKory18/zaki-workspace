import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ArchiveList } from "@/components/archive/archive-list";
import { ArchiveClient } from "@/lib/chat/archive/archive-client";

const item = (type: "deleted" | "edited" | "moderation" | "closed", extra = {}) => ({ type, id: type, conversationId: "c1", spaceId: "s1", spaceName: "المقر", at: "2026-10-23T12:00:00.000Z", ...extra });

describe("archive list", () => {
  it("renders human-readable person and space filters while retaining option IDs", () => {
    const html = renderToStaticMarkup(React.createElement(ArchiveClient, { options: { people: [{ id: "person-opaque", name: "سارة" }], spaces: [{ id: "space-opaque", name: "المقر" }] } }));
    expect(html).toContain("<select");
    expect(html).toContain("value=\"person-opaque\"");
    expect(html).toContain("سارة");
    expect(html).toContain("value=\"space-opaque\"");
    expect(html).toContain("المقر");
  });

  it("renders deleted original text, author, deleter, and space", () => {
    const html = renderToStaticMarkup(React.createElement(ArchiveList, { items: [item("deleted", { body: "النص الأصلي", authorName: "سارة", deletedByName: "أحمد", deletedAt: "2026-10-23T12:00:00.000Z" })] }));
    expect(html).toContain("النص الأصلي"); expect(html).toContain("سارة"); expect(html).toContain("أحمد"); expect(html).toContain("المقر");
  });
  it("renders edits, moderation, and closed-topic records by type", () => {
    const html = renderToStaticMarkup(React.createElement(ArchiveList, { items: [item("edited", { previousBody: "قبل التعديل", body: "بعد التعديل", authorName: "ليلى" }), item("moderation", { action: "chat.topic_closed", actorName: "أحمد", targetName: "ليلى" }), item("closed", { title: "متابعة الطلبات" })] }));
    expect(html).toContain("قبل التعديل"); expect(html).toContain("بعد التعديل"); expect(html).toContain("متابعة الطلبات"); expect(html).toContain("ليلى");
  });
  it("identifies closed records as topics", () => {
    const html = renderToStaticMarkup(React.createElement(ArchiveList, { items: [item("closed", { title: "موضوع مغلق" })] }));
    expect(html).toContain("موضوع مغلق"); expect(html).toContain("المقفول");
  });
});
