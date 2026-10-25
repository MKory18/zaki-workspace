import { describe, expect, it } from "vitest";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as homeRoute from "@/app/api/chat/home/route";
import * as unreadRoute from "@/app/api/chat/unread/route";
import * as topicsRoute from "@/app/api/chat/spaces/[spaceId]/topics/route";
import * as topicRoute from "@/app/api/chat/topics/[id]/route";
import { canReadConversation } from "@/server/policy/conversation";
import { readersAmong } from "@/server/chat/notify";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeWorkspace, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

/**
 * THE TOPICS OF A SPACE'S «مقاطع» (the owner's ask, 2026-10-25): a topic can belong to one مقطع of its space, and then
 * its people and the space's managers read it — nobody else in the space, anywhere (the topic, its unread count,
 * its notifications). «موضوع جديد» has a kind (نقاش، تنبيهات، مهام، أفكار، متابعة) and is for the whole space, one
 * مقطع, or named people.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

async function world() {
  const w = await makeTeamsWorld();
  const topic = (title: string, teamId: string | null) =>
    db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title, teamId } });
  const open = await topic("Open", null);
  const tx = await topic("X talk", w.x.id);
  const ty = await topic("Y talk", w.y.id);
  return { ...w, open, tx, ty };
}

describe("who reads a «مقطع»'s topic", () => {
  it("its people, the space's ADMIN, an org ADMIN in the space and the OWNER; nobody else in the space", async () => {
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: w.admin.id, role: "MEMBER" } });
    expect(await canReadConversation(w.alice.id, w.tx.id)).toBe(true);
    expect(await canReadConversation(w.alice.id, w.ty.id)).toBe(false);
    expect(await canReadConversation(w.carol.id, w.tx.id)).toBe(false);
    expect(await canReadConversation(w.carol.id, w.open.id)).toBe(true);
    for (const who of [w.spaceAdmin, w.admin, w.owner]) {
      expect(await canReadConversation(who.id, w.tx.id), who.name).toBe(true);
      expect(await canReadConversation(who.id, w.ty.id), who.name).toBe(true);
    }
    // the route says «not found», like a topic that does not exist
    await loginAs(w.alice.id);
    expect((await call(conversationRoute.GET, { params: { id: w.ty.id } })).status).toBe(404);
    expect((await call(conversationRoute.GET, { params: { id: w.tx.id } })).status).toBe(200);
  });

  it("a notification of a مقطع's topic reaches only its readers", async () => {
    const w = await world();
    expect((await readersAmong(w.tx.id, [w.alice.id, w.bob.id, w.carol.id, w.spaceAdmin.id])).sort()).toEqual([w.alice.id, w.spaceAdmin.id].sort());
  });
});

describe("the space's chat, grouped by «مقطع»", () => {
  it("a member gets the space's own topics and their مقطع's, with only their مقطع listed; a manager gets all", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    enter(w.s.id);
    const mine = ((await call(homeRoute.GET)).json as { spaces: Array<{ sections: { id: string }[]; topics: { id: string; teamId: string | null }[]; canCreateTopic: boolean }> }).spaces[0]!;
    expect(mine.sections.map((s) => s.id)).toEqual([w.x.id]);
    expect(mine.topics.map((t) => t.id).sort()).toEqual([w.open.id, w.tx.id].sort());
    expect(mine.topics.find((t) => t.id === w.tx.id)?.teamId).toBe(w.x.id);
    expect(mine.canCreateTopic).toBe(false);

    await loginAs(w.spaceAdmin.id);
    const all = ((await call(homeRoute.GET)).json as { spaces: Array<{ sections: { id: string }[]; topics: { id: string }[]; canCreateTopic: boolean }> }).spaces[0]!;
    expect(all.sections.map((s) => s.id).sort()).toEqual([w.x.id, w.y.id].sort());
    expect(all.topics.map((t) => t.id)).toEqual(expect.arrayContaining([w.open.id, w.tx.id, w.ty.id]));
    expect(all.canCreateTopic).toBe(true);
  });

  it("the unread count never counts a مقطع's topic for somebody outside it (even with an old row there)", async () => {
    const w = await world();
    const before = new Date(Date.now() - 60_000);
    await db.conversationMember.createMany({ data: [{ conversationId: w.ty.id, userId: w.alice.id, lastReadAt: before }, { conversationId: w.tx.id, userId: w.alice.id, lastReadAt: before }] });
    await db.chatMessage.createMany({
      data: [
        { orgId: w.org.id, conversationId: w.ty.id, authorId: w.bob.id, body: "Y only" },
        { orgId: w.org.id, conversationId: w.tx.id, authorId: w.spaceAdmin.id, body: "for X" },
      ],
    });
    await loginAs(w.alice.id);
    enter(w.s.id);
    expect((await call(unreadRoute.GET)).json?.["total"]).toBe(1);
  });
});

describe("«موضوع جديد»", () => {
  const post = (spaceId: string, body: Record<string, unknown>) => call(topicsRoute.POST, { params: { spaceId }, body });

  it("a kind gives the topic its mark; «التنبيهات» is written by the space's admins", async () => {
    const w = await world();
    await loginAs(w.spaceAdmin.id);
    const res = await post(w.s.id, { title: `News ${uid()}`, topicType: "ANNOUNCEMENTS" });
    expect(res.status).toBe(201);
    const made = await db.conversation.findUniqueOrThrow({ where: { id: (res.json as { id: string }).id }, select: { topicType: true, emoji: true, postingPolicy: true, teamId: true, restricted: true } });
    expect(made).toEqual({ topicType: "ANNOUNCEMENTS", emoji: "📢", postingPolicy: "ADMINS", teamId: null, restricted: false });
    const ideas = await post(w.s.id, { title: `Ideas ${uid()}`, topicType: "IDEAS" });
    expect((await db.conversation.findUniqueOrThrow({ where: { id: (ideas.json as { id: string }).id }, select: { emoji: true, postingPolicy: true } }))).toEqual({ emoji: "💡", postingPolicy: "ALL" });
  });

  it("for one «مقطع» of the space: only a مقطع of THAT space (another space's reads as not found)", async () => {
    const w = await world();
    await loginAs(w.spaceAdmin.id);
    const res = await post(w.s.id, { title: `X plan ${uid()}`, topicType: "TASKS", teamId: w.x.id });
    expect(res.status).toBe(201);
    const id = (res.json as { id: string }).id;
    expect(await canReadConversation(w.alice.id, id)).toBe(true);
    expect(await canReadConversation(w.bob.id, id)).toBe(false);

    const elsewhere = await makeWorkspace(w.org.id, [], `E ${uid()}`);
    const foreign = await db.team.create({ data: { workspaceId: elsewhere.id, name: `F ${uid()}` } });
    const refused = await post(w.s.id, { title: "nope", teamId: foreign.id });
    expect(refused.status).toBe(404);
    expect(refused.json?.["message"]).toBe("teams.not_found");
  });

  it("for named people: they are put in it and it is closed to the rest; nobody from outside the space", async () => {
    const w = await world();
    await loginAs(w.spaceAdmin.id);
    const res = await post(w.s.id, { title: `Private ${uid()}`, restricted: true, memberIds: [w.carol.id] });
    expect(res.status).toBe(201);
    const id = (res.json as { id: string }).id;
    expect(await canReadConversation(w.carol.id, id)).toBe(true);
    expect(await canReadConversation(w.alice.id, id)).toBe(false);
    expect((await db.conversationMember.findMany({ where: { conversationId: id }, select: { userId: true } })).map((m) => m.userId).sort()).toEqual([w.carol.id, w.spaceAdmin.id].sort());

    const outsider = await call(topicsRoute.POST, { params: { spaceId: w.s.id }, body: { title: "x", restricted: true, memberIds: [w.member.id] } });
    expect(outsider.status).toBe(403);
    expect(outsider.json?.["message"]).toBe("teams.member_not_in_space");
  });

  it("a plain member does not open topics (403); a manager moves one to a «مقطع» and back", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    expect((await post(w.s.id, { title: "mine" })).status).toBe(403);

    await loginAs(w.spaceAdmin.id);
    expect((await call(topicRoute.PATCH, { method: "PATCH", params: { id: w.open.id }, body: { teamId: w.y.id } })).status).toBe(200);
    expect(await canReadConversation(w.alice.id, w.open.id)).toBe(false);
    expect((await call(topicRoute.PATCH, { method: "PATCH", params: { id: w.open.id }, body: { teamId: null, topicType: "FOLLOWUP" } })).status).toBe(200);
    expect(await canReadConversation(w.alice.id, w.open.id)).toBe(true);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: w.open.id }, select: { topicType: true } })).topicType).toBe("FOLLOWUP");
  });
});
