import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as homeRoute from "@/app/api/chat/home/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as readRoute from "@/app/api/chat/conversations/[id]/read/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as forwardRoute from "@/app/api/chat/messages/[id]/forward/route";
import * as muteRoute from "@/app/api/chat/spaces/[spaceId]/mute/route";
import { openDm } from "@/server/chat/dm";
import type { ConversationDto, HomeDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * The chat's rules that had no DB test (review C item 5, from 12-PHASE3-TASKS.md), each through the
 * routes people use: the redaction walk, the idempotent send, the edit history, delete keeps the body,
 * read never goes backwards, the home never lists a hidden topic, the mute between equals, the forward
 * permission and the DM race.
 */
const detail = async (id: string) =>
  (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } })).json as unknown as ConversationDto;
const send = (id: string, body: Record<string, unknown>) => call(messagesRoute.POST, { params: { id }, body });
const home = async () => (await call(homeRoute.GET)).json as unknown as HomeDto;

async function world() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }, { userId: t.guest.id, role: "GUEST" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  return { ...t, ws, topic };
}

describe("the redaction walk: a deleted message's words never reach anybody but the owner", () => {
  it("not in the message, not in a reply's preview, not in the home's last line; the owner reads the original", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const secret = (await send(w.topic.id, { body: "كلمة السر 1234" })).json?.["id"] as string;
    await loginAs(w.admin.id);
    await send(w.topic.id, { body: "رد", replyToId: secret });
    await loginAs(w.member.id);
    expect((await call(messageRoute.DELETE, { method: "DELETE", params: { id: secret } })).status).toBe(200);

    for (const who of [w.member.id, w.admin.id, w.guest.id]) {
      await loginAs(who);
      const d = await detail(w.topic.id);
      expect(JSON.stringify(d), who).not.toContain("كلمة السر");
      const reply = d.messages.find((m) => m.replyTo?.id === secret);
      expect(reply?.replyTo).toMatchObject({ preview: null, deleted: true });
      expect(JSON.stringify(await home()), who).not.toContain("كلمة السر");
    }
    await loginAs(w.owner.id);
    const owner = await detail(w.topic.id);
    expect(owner.messages.find((m) => m.id === secret)?.original?.body).toBe("كلمة السر 1234");
  });

  it("delete keeps the body in the database (the archive), only a tombstone hides it", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const id = (await send(w.topic.id, { body: "يبقى محفوظًا" })).json?.["id"] as string;
    await call(messageRoute.DELETE, { method: "DELETE", params: { id } });
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id } });
    expect(row.body).toBe("يبقى محفوظًا");
    expect(row.deletedAt).not.toBeNull();
  });
});

describe("sending and editing", () => {
  it("the same clientId twice is one message (a retried send never doubles)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = await send(w.topic.id, { body: "مرة وحدة", clientId: "c-1" });
    const b = await send(w.topic.id, { body: "مرة وحدة", clientId: "c-1" });
    expect(b.json?.["id"]).toBe(a.json?.["id"]);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id, body: "مرة وحدة" } })).toBe(1);
  });

  it("an edit keeps the old words in the history: the owner reads them, a member does not", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const id = (await send(w.topic.id, { body: "قبل" })).json?.["id"] as string;
    expect((await call(messageRoute.PATCH, { method: "PATCH", params: { id }, body: { body: "بعد" } })).status).toBe(200);
    expect((await db.messageRevision.findMany({ where: { messageId: id } })).map((r) => r.body)).toEqual(["قبل"]);
    const mine = (await detail(w.topic.id)).messages.find((m) => m.id === id);
    expect(mine).toMatchObject({ body: "بعد", edited: true });
    expect(mine?.history).toBeUndefined();
    await loginAs(w.owner.id);
    expect((await detail(w.topic.id)).messages.find((m) => m.id === id)?.history?.map((h) => h.body)).toEqual(["قبل"]);
  });
});

describe("read marks and what the home lists", () => {
  it("a read mark never goes backwards", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const first = (await send(w.topic.id, { body: "1" })).json?.["id"] as string;
    const second = (await send(w.topic.id, { body: "2" })).json?.["id"] as string;
    await loginAs(w.member.id);
    const read = (upTo: string) => call(readRoute.POST, { method: "POST", url: `http://localhost/api/chat/conversations/${w.topic.id}/read?upTo=${upTo}`, params: { id: w.topic.id } });
    await read(second);
    const after = (await db.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: w.topic.id, userId: w.member.id } } })).lastReadAt;
    await read(first);
    const again = (await db.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: w.topic.id, userId: w.member.id } } })).lastReadAt;
    expect(again.getTime()).toBe(after.getTime());
  });

  it("the home never lists a restricted topic to somebody outside it; it does to the people in it", async () => {
    const w = await world();
    const hidden = await db.conversation.create({
      data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "Board only", restricted: true, members: { create: [{ userId: w.admin.id }] } },
    });
    for (const [who, sees] of [[w.member.id, false], [w.guest.id, false], [w.admin.id, true]] as const) {
      await loginAs(who);
      const ids = (await home()).spaces.flatMap((s) => s.topics.map((t) => t.id));
      expect(ids.includes(hidden.id), who).toBe(sees);
      expect(ids).toContain(w.topic.id);
    }
  });
});

describe("the mute: never an equal, never the owner", () => {
  it("a space admin mutes a member, not another space admin; the owner mutes an admin; nobody mutes the owner", async () => {
    const w = await world();
    const admin2 = await makeUser({ orgId: w.org.id, role: "ADMIN", name: "Admin2" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: admin2.id, role: "ADMIN" } });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.owner.id, role: "ADMIN" } });
    const mute = (userId: string) => call(muteRoute.POST, { params: { spaceId: w.ws.id }, body: { userId, until: "1h" } });

    await loginAs(w.admin.id);
    expect((await mute(w.member.id)).status).toBe(200);
    expect((await mute(admin2.id)).status).toBe(403);
    expect((await mute(w.owner.id)).status).toBe(403);
    await loginAs(w.owner.id);
    expect((await mute(admin2.id)).status).toBe(200);
    await loginAs(w.member.id);
    expect((await mute(w.guest.id)).status).toBe(403); // a member moderates nobody
  });
});

describe("forwarding", () => {
  it("only into a conversation I may write in; the copy is mine and says where it came from", async () => {
    const w = await world();
    const announcements = await db.conversation.create({
      data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "التنبيهات", topicType: "ANNOUNCEMENTS", postingPolicy: "ADMINS" },
    });
    await loginAs(w.admin.id);
    const original = (await send(w.topic.id, { body: "للنشر" })).json?.["id"] as string;
    await loginAs(w.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.admin.id } })).json?.["id"] as string;
    expect((await call(forwardRoute.POST, { params: { id: original }, body: { conversationId: announcements.id } })).status).toBe(403);
    const ok = await call(forwardRoute.POST, { params: { id: original }, body: { conversationId: dm } });
    expect(ok.status).toBeLessThan(300);
    const copy = await db.chatMessage.findUniqueOrThrow({ where: { id: ok.json?.["id"] as string } });
    expect(copy).toMatchObject({ conversationId: dm, authorId: w.member.id, forwardedFromId: original, body: "للنشر" });
  });
});

describe("the DM race", () => {
  it("two people opening the same DM at the same moment get ONE conversation", async () => {
    const w = await world();
    const results = await Promise.allSettled([
      openDm({ orgId: w.org.id, orgRole: "MEMBER", userId: w.member.id }, w.admin.id),
      openDm({ orgId: w.org.id, orgRole: "ADMIN", userId: w.admin.id }, w.member.id),
    ]);
    const ids = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.id] : []));
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ids).size).toBe(1);
    expect(await db.conversation.count({ where: { orgId: w.org.id, kind: "DM" } })).toBe(1);
  });
});
