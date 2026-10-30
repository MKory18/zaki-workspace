import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as readRoute from "@/app/api/chat/conversations/[id]/read/route";
import * as deliveredRoute from "@/app/api/chat/conversations/[id]/delivered/route";
import * as joinRoute from "@/app/api/chat/conversations/[id]/join/route";
import * as topicRoute from "@/app/api/chat/topics/[id]/route";
import * as homeRoute from "@/app/api/chat/home/route";
import { markDeliveredForUser } from "@/server/chat/read-state";
import type { ConversationDto, HomeDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const send = async (conversationId: string, body: string) =>
  (await call(messagesRoute.POST, { params: { id: conversationId }, body: { body } })).json?.["id"] as string;
const detail = async (conversationId: string) =>
  (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${conversationId}`, params: { id: conversationId } })).json as unknown as ConversationDto;
const read = (conversationId: string, upTo?: string) =>
  call(readRoute.POST, {
    method: "POST",
    url: `http://localhost/api/chat/conversations/${conversationId}/read${upTo ? `?upTo=${upTo}` : ""}`,
    params: { id: conversationId },
  });
const delivered = (conversationId: string) => call(deliveredRoute.POST, { method: "POST", params: { id: conversationId } });
const home = async () => (await call(homeRoute.GET)).json as unknown as HomeDto;
const openDm = async (withId: string) => (await call(dmRoute.POST, { body: { userId: withId } })).json?.["id"] as string;
const eventsOf = async (conversationId: string, kind: string) =>
  (await db.realtimeEvent.findMany({ where: { kind }, orderBy: { id: "asc" } }))
    .map((e) => e.ids as Record<string, string>)
    .filter((ids) => ids["conversationId"] === conversationId);

async function topicWorld() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  return { ...t, ws, topic };
}

describe("DM ticks: ✓ sent, ✓✓ delivered, ✓✓ blue read", () => {
  it("my message moves from sent to delivered to read with the other person's marks", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const dm = await openDm(t.admin.id);
    const id = await send(dm, "مرحبا");
    expect((await detail(dm)).messages.find((m) => m.id === id)?.status).toBe("sent");

    await loginAs(t.admin.id);
    expect((await delivered(dm)).status).toBeLessThan(300);
    await loginAs(t.member.id);
    expect((await detail(dm)).messages.find((m) => m.id === id)?.status).toBe("delivered");

    await loginAs(t.admin.id);
    expect((await read(dm, id)).status).toBe(200);
    await loginAs(t.member.id);
    expect((await detail(dm)).messages.find((m) => m.id === id)?.status).toBe("read");
    // the reader's mark is an event the SENDER's screen receives
    expect((await eventsOf(dm, "conversation.read")).some((ids) => ids["userId"] === t.admin.id && !ids["targetUserId"])).toBe(true);
  });

  it("the owner's reading stays silent in his own DM: never blue, no read event", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const dm = await openDm(t.owner.id);
    const id = await send(dm, "صباح الخير");
    await loginAs(t.owner.id);
    await delivered(dm);
    expect((await read(dm, id)).status).toBe(200);
    await loginAs(t.member.id);
    expect((await detail(dm)).messages.find((m) => m.id === id)?.status).toBe("delivered");
    expect(await eventsOf(dm, "conversation.read")).toEqual([]);
  });
});

describe("delivery marks (markDeliveredForUser)", () => {
  it("mark a DM delivered only for a message from the other person, with a conversation.delivered event", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const dm = await openDm(t.admin.id);
    await send(dm, "first");
    // the author's own message never marks the author's side delivered
    await markDeliveredForUser(t.member.id);
    expect(await eventsOf(dm, "conversation.delivered")).toEqual([]);
    // the recipient's side moves, once, with its event
    await markDeliveredForUser(t.admin.id);
    await markDeliveredForUser(t.admin.id);
    const events = await eventsOf(dm, "conversation.delivered");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: t.admin.id });
  });

  it("never touch a topic", async () => {
    const w = await topicWorld();
    await loginAs(w.member.id);
    await send(w.topic.id, "hi");
    await db.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: w.topic.id, userId: w.admin.id } },
      create: { conversationId: w.topic.id, userId: w.admin.id },
      update: {},
    });
    await markDeliveredForUser(w.admin.id);
    expect(await eventsOf(w.topic.id, "conversation.delivered")).toEqual([]);
    const row = await db.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: w.topic.id, userId: w.admin.id } } });
    expect(row.lastDeliveredAt).toBeNull();
  });
});

describe("reader avatars in a topic", () => {
  it("each reader sits under the newest message they read; never the viewer, never the owner", async () => {
    const w = await topicWorld();
    await loginAs(w.member.id);
    const first = await send(w.topic.id, "one");
    const second = await send(w.topic.id, "two");

    // the admin reads up to the first one (an open topic: no row before, no 404 now)
    await loginAs(w.admin.id);
    expect((await read(w.topic.id, first)).status).toBe(200);

    // the owner joins and reads everything: silent
    await loginAs(w.owner.id);
    expect((await call(joinRoute.POST, { url: `http://localhost/api/chat/conversations/${w.topic.id}`, params: { id: w.topic.id } })).status).toBe(200);
    expect((await read(w.topic.id, second)).status).toBe(200);

    await loginAs(w.member.id);
    const readers = (await detail(w.topic.id)).readers;
    expect(readers).toEqual([{ userId: w.admin.id, name: "Admin", messageId: first, readAt: expect.any(String) }]);
    // «who and when»: the time is the person's own read mark
    const mark = await db.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: w.topic.id, userId: w.admin.id } } });
    expect(readers[0]!.readAt).toBe(mark.lastReadAt.toISOString());
    // the owner's read left no event either
    expect((await eventsOf(w.topic.id, "conversation.read")).map((ids) => ids["userId"])).toEqual([w.admin.id]);
  });

  it("the owner in oversight leaves no trace at all: no row, no event", async () => {
    const w = await topicWorld();
    await loginAs(w.member.id);
    const id = await send(w.topic.id, "hi");
    await loginAs(w.owner.id);
    expect((await read(w.topic.id, id)).status).toBe(200);
    expect(await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: w.topic.id, userId: w.owner.id } } })).toBeNull();
    expect(await eventsOf(w.topic.id, "conversation.read")).toEqual([]);
  });
});

describe("the chat home's counts", () => {
  it("an open topic's count clears for a space person who had no row (the company's topics)", async () => {
    const w = await topicWorld();
    await loginAs(w.member.id);
    const id = await send(w.topic.id, "hi");
    await loginAs(w.admin.id);
    const before = (await home()).spaces.flatMap((s) => s.topics).find((t) => t.id === w.topic.id);
    expect(before?.unread).toBe(1);
    expect((await read(w.topic.id, id)).status).toBe(200);
    const after = (await home()).spaces.flatMap((s) => s.topics).find((t) => t.id === w.topic.id);
    expect(after?.unread).toBe(0);
  });

  it("a system line is not counted, and its preview is an Arabic sentence, not JSON", async () => {
    const w = await topicWorld();
    await loginAs(w.admin.id);
    expect((await call(topicRoute.PATCH, { method: "PATCH", params: { id: w.topic.id }, body: { closed: true } })).status).toBeLessThan(300);
    await loginAs(w.member.id);
    const topic = (await home()).spaces.flatMap((s) => s.topics).find((t) => t.id === w.topic.id);
    expect(topic?.unread).toBe(0);
    expect(topic?.lastMessage?.preview).toBe("إغلاق الموضوع بواسطة Admin");
  });

  it("the owner's oversight shows no count that could never clear", async () => {
    const w = await topicWorld();
    await loginAs(w.member.id);
    await send(w.topic.id, "hi");
    await loginAs(w.owner.id);
    const topic = (await home()).spaces.flatMap((s) => s.topics).find((t) => t.id === w.topic.id);
    expect(topic?.unread).toBe(0);
  });
});

describe("a second owner (co-owner) is just as silent as the first", () => {
  async function coOwnerWorld() {
    const w = await topicWorld();
    const co = await makeUser({ orgId: w.org.id, role: "OWNER", name: "CoOwner" });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: co.id } }, data: { primaryOwner: false } });
    return { ...w, co };
  }

  it("reading in oversight leaves no row, no event, no avatar", async () => {
    const w = await coOwnerWorld();
    await loginAs(w.member.id);
    const id = await send(w.topic.id, "hi");
    await loginAs(w.co.id);
    expect((await read(w.topic.id, id)).status).toBe(200);
    expect(await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: w.topic.id, userId: w.co.id } } })).toBeNull();
    expect(await eventsOf(w.topic.id, "conversation.read")).toEqual([]);
    await loginAs(w.member.id);
    expect((await detail(w.topic.id)).readers).toEqual([]);
  });

  it("a co-owner who JOINED the topic and reads still shows no avatar and sends no read event", async () => {
    const w = await coOwnerWorld();
    await loginAs(w.member.id);
    const id = await send(w.topic.id, "hi");
    await loginAs(w.co.id);
    expect((await call(joinRoute.POST, { url: `http://localhost/api/chat/conversations/${w.topic.id}`, params: { id: w.topic.id } })).status).toBe(200);
    expect((await read(w.topic.id, id)).status).toBe(200);
    await loginAs(w.member.id);
    expect((await detail(w.topic.id)).readers).toEqual([]);
    expect(await eventsOf(w.topic.id, "conversation.read")).toEqual([]);
  });

  it("in his own DM his reading never turns the other person's ticks blue", async () => {
    const w = await coOwnerWorld();
    await loginAs(w.member.id);
    const dm = await openDm(w.co.id);
    const id = await send(dm, "hello");
    await loginAs(w.co.id);
    expect((await read(dm, id)).status).toBe(200);
    await loginAs(w.member.id);
    expect((await detail(dm)).messages.find((m) => m.id === id)?.status).not.toBe("read");
  });
});
