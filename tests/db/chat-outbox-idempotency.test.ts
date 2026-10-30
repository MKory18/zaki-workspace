import { describe, expect, it } from "vitest";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { conversationDetail } from "@/server/chat/topics";
import { withFeature } from "@/lib/features";
import type { Prisma } from "@prisma/client";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * «الرسائل بدون نت»: the outbox sends a message again until the server answers, and the one thing that makes that safe
 * is the server's idempotency: the same `clientId` of the same author is the same message. A retry after a timeout
 * whose first attempt DID reach the server must never make a second message.
 */
async function topicWith(...who: Array<"member" | "admin">) {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, who.map((w) => ({ userId: t[w].id })));
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "موضوع" } });
  return { t, topic };
}

describe("a retry with the same clientId is never a second message (through the real route)", () => {
  it("two POSTs with one clientId → ONE row, and the same id comes back", async () => {
    const { t, topic } = await topicWith("member");
    await loginAs(t.member.id);
    const body = { body: "ما في نت عندي", clientId: "outbox-retry-1" };
    const first = await call(messagesRoute.POST, { params: { id: topic.id }, body });
    const second = await call(messagesRoute.POST, { params: { id: topic.id }, body }); // the retry: the first answer was lost on the way
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.json?.["id"]).toBe(first.json?.["id"]);
    expect(second.json?.["clientId"]).toBe("outbox-retry-1"); // what the screen reconciles the pending bubble with
    expect(await db.chatMessage.count({ where: { conversationId: topic.id, clientId: "outbox-retry-1" } })).toBe(1);
    expect(await db.chatMessage.count({ where: { conversationId: topic.id } })).toBe(1);
  });

  it("the retry is a no-op even after the message was edited: the answer is the stored message, not a new one", async () => {
    const { t, topic } = await topicWith("member");
    await loginAs(t.member.id);
    const first = await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: "الأصل", clientId: "outbox-retry-2" } });
    await db.chatMessage.update({ where: { id: first.json?.["id"] as string }, data: { body: "بعد التعديل" } });
    const retry = await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: "الأصل", clientId: "outbox-retry-2" } });
    expect(retry.json?.["id"]).toBe(first.json?.["id"]);
    expect(retry.json?.["body"]).toBe("بعد التعديل");
    expect(await db.chatMessage.count({ where: { conversationId: topic.id } })).toBe(1);
  });

  it("a queue of several messages retried in a row gives one row each, in the order they were written", async () => {
    const { t, topic } = await topicWith("member");
    await loginAs(t.member.id);
    const ids = ["q-a", "q-b", "q-c"];
    for (const clientId of ids) await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: `نص ${clientId}`, clientId } });
    for (const clientId of ids) await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: `نص ${clientId}`, clientId } }); // everything retried
    const rows = await db.chatMessage.findMany({ where: { conversationId: topic.id }, orderBy: { createdAt: "asc" }, select: { clientId: true } });
    expect(rows.map((r) => r.clientId)).toEqual(ids);
  });

  it("the key is per author: another person's message with the same clientId is their own message", async () => {
    const { t, topic } = await topicWith("member", "admin");
    await loginAs(t.member.id);
    const mine = await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: "أنا", clientId: "shared-id" } });
    await loginAs(t.admin.id);
    const theirs = await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: "هو", clientId: "shared-id" } });
    expect(theirs.status).toBe(201);
    expect(theirs.json?.["id"]).not.toBe(mine.json?.["id"]);
    expect(await db.chatMessage.count({ where: { conversationId: topic.id, clientId: "shared-id" } })).toBe(2);
  });

  it("two attempts in flight at the same moment still end with ONE row (the loser is told «conflict», which the outbox treats as «try again»)", async () => {
    const { t, topic } = await topicWith("member");
    await loginAs(t.member.id);
    const body = { body: "تزامن", clientId: "outbox-race" };
    const [a, b] = await Promise.all([call(messagesRoute.POST, { params: { id: topic.id }, body }), call(messagesRoute.POST, { params: { id: topic.id }, body })]);
    expect([a.status, b.status].every((s) => s === 201 || s === 409)).toBe(true);
    expect(await db.chatMessage.count({ where: { conversationId: topic.id, clientId: "outbox-race" } })).toBe(1);
    // the next attempt (what the queue does after a 409) finds the message
    const again = await call(messagesRoute.POST, { params: { id: topic.id }, body });
    expect(again.status).toBe(201);
    const winner = [a, b].find((r) => r.status === 201);
    if (winner) expect(again.json?.["id"]).toBe(winner.json?.["id"]);
  });
});

describe("the definitive refusals the outbox marks «تعذّر الإرسال» are real answers of the route", () => {
  it("403 when the person may no longer post (a person outside the space), 404 for a conversation that is gone, 422 for a refused message", async () => {
    const { t, topic } = await topicWith("member");
    const outsider = t.admin; // not in the space
    await loginAs(outsider.id);
    const forbidden = await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: "x", clientId: "r-1" } });
    expect([403, 404]).toContain(forbidden.status); // a topic one cannot read does not exist for them
    await loginAs(t.member.id);
    const gone = await call(messagesRoute.POST, { params: { id: "no-such-conversation" }, body: { body: "x", clientId: "r-2" } });
    expect(gone.status).toBe(404);
    const invalid = await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: "   ", clientId: "r-3" } });
    expect(invalid.status).toBe(422);
    expect(await db.chatMessage.count({ where: { conversationId: topic.id } })).toBe(0);
  });
});

describe("«الرسائل بدون نت» is a switch of «الميزات»", () => {
  it("the conversation carries it (on by default) and says so when it is off; the messages are the same either way", async () => {
    const { t, topic } = await topicWith("member");
    await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: topic.id, authorId: t.member.id, body: "مرحبا" } });
    await loginAs(t.member.id);
    const ctx = { orgId: t.org.id, userId: t.member.id, orgRole: "MEMBER" } as never;
    const on = await conversationDetail(ctx, topic.id);
    expect(on.chatOutbox).toBe(true);
    const org = await db.organization.findUniqueOrThrow({ where: { id: t.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: t.org.id }, data: { settings: withFeature(org.settings, "chatOutbox", false) as Prisma.InputJsonValue } });
    const off = await conversationDetail(ctx, topic.id);
    expect(off.chatOutbox).toBe(false);
    expect(off.messages.map((m) => m.id)).toEqual(on.messages.map((m) => m.id));
  });
});
