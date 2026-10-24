import { describe, expect, it } from "vitest";
import * as joinRoute from "@/app/api/chat/conversations/[id]/join/route";
import * as conversationMessagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as pinRoute from "@/app/api/chat/messages/[id]/pin/route";
import * as topicRoute from "@/app/api/chat/topics/[id]/route";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/** The realtime rows written for one conversation, oldest first. */
const eventsOf = async (conversationId: string) =>
  (await db.realtimeEvent.findMany({ orderBy: { id: "asc" } }))
    .map((e) => ({ kind: e.kind, ids: e.ids as Record<string, string> }))
    .filter((e) => e.ids["conversationId"] === conversationId);

async function topicWorld() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  return { ...t, ws, topic };
}

describe("chat: a system line («انضم»، «ثبّت»، «أُغلق») appears live, like any message", () => {
  it("joining a topic writes the join line and its message.created event", async () => {
    const w = await topicWorld();
    await loginAs(w.owner.id);
    expect((await call(joinRoute.POST, { url: `http://localhost/api/chat/conversations/${w.topic.id}`, params: { id: w.topic.id } })).status).toBe(200);
    const line = await db.chatMessage.findFirstOrThrow({ where: { conversationId: w.topic.id, kind: "SYSTEM" } });
    const events = await eventsOf(w.topic.id);
    expect(events.some((e) => e.kind === "message.created" && e.ids["messageId"] === line.id)).toBe(true);
  });

  it("pinning writes the pin line and its message.created event", async () => {
    const w = await topicWorld();
    await loginAs(w.member.id);
    const sent = await call(conversationMessagesRoute.POST, { params: { id: w.topic.id }, body: { body: "pin me" } });
    await loginAs(w.admin.id);
    expect((await call(pinRoute.POST, { params: { id: sent.json?.["id"] as string } })).status).toBeLessThan(300);
    const line = await db.chatMessage.findFirstOrThrow({ where: { conversationId: w.topic.id, kind: "SYSTEM" } });
    expect(JSON.parse(line.body)).toMatchObject({ k: "pin" });
    expect((await eventsOf(w.topic.id)).some((e) => e.kind === "message.created" && e.ids["messageId"] === line.id)).toBe(true);
  });

  it("closing a topic writes the close line and its message.created event", async () => {
    const w = await topicWorld();
    await loginAs(w.admin.id);
    expect((await call(topicRoute.PATCH, { method: "PATCH", params: { id: w.topic.id }, body: { closed: true } })).status).toBeLessThan(300);
    const line = await db.chatMessage.findFirstOrThrow({ where: { conversationId: w.topic.id, kind: "SYSTEM" } });
    expect(JSON.parse(line.body)).toMatchObject({ k: "close" });
    expect((await eventsOf(w.topic.id)).some((e) => e.kind === "message.created" && e.ids["messageId"] === line.id)).toBe(true);
  });

  it("a read mark names its reader as the subject, not as a target (it is for the whole audience)", async () => {
    const w = await topicWorld();
    await loginAs(w.member.id);
    const sent = await call(conversationMessagesRoute.POST, { params: { id: w.topic.id }, body: { body: "hello" } });
    // the member has a row whose read mark is behind the message; their read mark is an event about them, for everybody
    const behind = new Date(0);
    await db.conversationMember.upsert({ where: { conversationId_userId: { conversationId: w.topic.id, userId: w.member.id } }, create: { conversationId: w.topic.id, userId: w.member.id, lastReadAt: behind }, update: { lastReadAt: behind } });
    const { markRead } = await import("@/server/chat/messages");
    await markRead({ orgId: w.org.id, userId: w.member.id, orgRole: "MEMBER" }, w.topic.id, sent.json?.["id"] as string);
    const read = (await eventsOf(w.topic.id)).find((e) => e.kind === "conversation.read");
    expect(read?.ids["userId"]).toBe(w.member.id);
    expect(read?.ids["targetUserId"]).toBeUndefined();
  });
});
