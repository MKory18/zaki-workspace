import { beforeEach, describe, expect, it } from "vitest";
import * as conversationMessagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { resetPresenceForTests, touchPresence } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

let t: Awaited<ReturnType<typeof makeTeam>>;
let poster: Awaited<ReturnType<typeof makeUser>>;
let online: Awaited<ReturnType<typeof makeUser>>;
let noRow: Awaited<ReturnType<typeof makeUser>>;
let outsider: Awaited<ReturnType<typeof makeUser>>;
let guest: Awaited<ReturnType<typeof makeUser>>;
let spaceId: string;
let topicId: string;

beforeEach(async () => {
  resetPresenceForTests();
  t = await makeTeam();
  poster = await makeUser({ orgId: t.org.id, name: "Poster" });
  online = await makeUser({ orgId: t.org.id, name: "Online" });
  noRow = await makeUser({ orgId: t.org.id, name: "NoRow" });
  outsider = await makeUser({ orgId: t.org.id, name: "Outsider" });
  guest = await makeUser({ orgId: t.org.id, name: "Guest", role: "GUEST" });
  const ws = await makeWorkspace(t.org.id, [
    { userId: poster.id },
    { userId: online.id },
    { userId: noRow.id },
    { userId: guest.id, role: "GUEST" },
  ]);
  spaceId = ws.id;
  // an open topic: only the poster and `online` have a row in it, `noRow` is in the space only
  topicId = (await db.conversation.create({
    data: { orgId: t.org.id, kind: "TOPIC", spaceId, title: "General", members: { create: [{ userId: poster.id }, { userId: online.id }] } },
  })).id;
});

async function post(who: string, body: string, extra: Record<string, unknown> = {}) {
  await loginAs(who);
  return call(conversationMessagesRoute.POST, { params: { id: topicId }, body: { body, ...extra } });
}

const bell = (userId: string) => db.notification.findMany({ where: { userId, type: "chat_message" }, select: { title: true, body: true } });

describe("a mention reaches the person like in a messenger", () => {
  it("notifies the mentioned person even while they are looking at the app, and says who mentioned them", async () => {
    touchPresence(online.id); // a live stream: the person is online
    const text = `look ${uid()}`;
    expect((await post(poster.id, text, { mentions: [online.id] })).status).toBe(201);
    const rows = await bell(online.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toContain(text);
    expect(rows[0]!.title).toContain("Poster");
    expect(rows[0]!.title).toContain("ذكرك");
  });

  it("a plain message to an online person still makes no notification", async () => {
    touchPresence(online.id);
    await post(poster.id, `no mention ${uid()}`, { replyToId: undefined });
    expect(await bell(online.id)).toHaveLength(0);
  });
});

describe("«@الكل»", () => {
  it("notifies everybody the open topic reaches (the space), not the author, not people outside the space", async () => {
    touchPresence(online.id);
    const text = `@الكل meeting ${uid()}`;
    const res = await post(poster.id, text, { mentionAll: true });
    expect(res.status).toBe(201);
    expect(await bell(online.id)).toHaveLength(1);
    expect(await bell(noRow.id)).toHaveLength(1);
    expect(await bell(guest.id)).toHaveLength(1);
    expect(await bell(poster.id)).toHaveLength(0);
    expect(await bell(outsider.id)).toHaveLength(0);
    expect(await bell(t.owner.id)).toHaveLength(0); // the owner is not in the space: no trace of him
    const stored = await db.chatMessage.findFirstOrThrow({ where: { body: text } });
    expect(stored.mentions).toContain("*");
  });

  it("is refused to a guest, and stays plain text", async () => {
    const res = await post(guest.id, `@الكل hi ${uid()}`, { mentionAll: true });
    expect(res.status).toBe(403);
  });

  it("in a restricted topic reaches only its own people", async () => {
    await db.conversation.update({ where: { id: topicId }, data: { restricted: true } });
    await post(poster.id, `@الكل secret ${uid()}`, { mentionAll: true });
    expect(await bell(online.id)).toHaveLength(1);
    expect(await bell(noRow.id)).toHaveLength(0);
  });

  it("counts in the topic list as a mention for everybody it reached", async () => {
    await post(poster.id, `@الكل ${uid()}`, { mentionAll: true });
    const stored = await db.chatMessage.findFirstOrThrow({ where: { conversationId: topicId }, orderBy: { createdAt: "desc" } });
    expect(stored.mentions).toEqual(["*"]);
  });
});

describe("the people the composer offers to mention", () => {
  it("lists the whole space of an open topic, not only the people who joined the topic", async () => {
    await loginAs(poster.id);
    const res = await call(conversationRoute.GET, { params: { id: topicId } });
    expect(res.status).toBe(200);
    const detail = res.json as { mentionables?: { id: string }[]; me: { canMentionAll?: boolean } };
    const ids = (detail.mentionables ?? []).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([online.id, noRow.id]));
    expect(ids).not.toContain(outsider.id);
    expect(detail.me.canMentionAll).toBe(true);
  });

  it("a guest is not offered «@الكل»", async () => {
    await loginAs(guest.id);
    const res = await call(conversationRoute.GET, { params: { id: topicId } });
    expect((res.json as { me: { canMentionAll?: boolean } }).me.canMentionAll).toBe(false);
  });
});

describe("what a guest is given", () => {
  it("never the space's people, so no names and no pictures beyond the topic's own rows", async () => {
    await loginAs(guest.id);
    const res = await call(conversationRoute.GET, { params: { id: topicId } });
    const detail = res.json as { mentionables?: { id: string }[] };
    const ids = (detail.mentionables ?? []).map((m) => m.id);
    expect(ids).not.toContain(noRow.id);
  });
});
