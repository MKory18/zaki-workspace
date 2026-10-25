import { describe, expect, it } from "vitest";
import * as topicRoute from "@/app/api/chat/topics/[id]/route";
import { conversationDetail } from "@/server/chat/topics";
import { canPostInConversation, canReadConversation } from "@/server/policy/conversation";
import { call, db, loginAs, makeUser } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

/**
 * «إعدادات الموضوع» (the owner's ask, 2026-10-25: every topic has its own privacy — who sees and reads it, who
 * writes in it). The space's ADMIN and the OWNER set, on an existing topic: who sees and reads it (the whole space,
 * one «مقطع», or named people of the space) and who writes (everybody who reads it, or the space's admins).
 */

async function world() {
  const w = await makeTeamsWorld();
  const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: "Plans" } });
  return { ...w, topic };
}
const patch = (id: string, body: Record<string, unknown>) => call(topicRoute.PATCH, { method: "PATCH", params: { id }, body });

describe("who sees and reads a topic", () => {
  it("named people: they and the one who set it read it, nobody else of the space", async () => {
    const w = await world();
    await loginAs(w.spaceAdmin.id);
    expect((await patch(w.topic.id, { restricted: true, teamId: null, memberIds: [w.carol.id] })).status).toBe(200);
    expect(await canReadConversation(w.carol.id, w.topic.id)).toBe(true);
    expect(await canReadConversation(w.alice.id, w.topic.id)).toBe(false);
    const rows = await db.conversationMember.findMany({ where: { conversationId: w.topic.id }, select: { userId: true } });
    expect(rows.map((r) => r.userId).sort()).toEqual([w.carol.id, w.spaceAdmin.id].sort());

    // changing the list takes the others out (and their row with them)
    expect((await patch(w.topic.id, { restricted: true, memberIds: [w.alice.id] })).status).toBe(200);
    expect(await canReadConversation(w.carol.id, w.topic.id)).toBe(false);
    expect(await canReadConversation(w.alice.id, w.topic.id)).toBe(true);
  });

  it("nobody from outside the space is named (403)", async () => {
    const w = await world();
    const stranger = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Stranger" });
    await loginAs(w.spaceAdmin.id);
    const res = await patch(w.topic.id, { restricted: true, memberIds: [stranger.id] });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("teams.member_not_in_space");
    expect(await canReadConversation(w.alice.id, w.topic.id)).toBe(true); // nothing changed
  });

  it("one «مقطع», then the whole space again; the conversation says which", async () => {
    const w = await world();
    await loginAs(w.spaceAdmin.id);
    expect((await patch(w.topic.id, { restricted: false, teamId: w.x.id })).status).toBe(200);
    expect(await canReadConversation(w.alice.id, w.topic.id)).toBe(true);
    expect(await canReadConversation(w.bob.id, w.topic.id)).toBe(false);
    const detail = await conversationDetail({ orgId: w.org.id, userId: w.spaceAdmin.id, orgRole: "MEMBER" }, w.topic.id);
    expect(detail.teamId).toBe(w.x.id);
    expect((await patch(w.topic.id, { restricted: false, teamId: null })).status).toBe(200);
    expect(await canReadConversation(w.bob.id, w.topic.id)).toBe(true);
  });
});

describe("who writes in a topic", () => {
  it("everybody who reads it, or the space's admins only", async () => {
    const w = await world();
    expect(await canPostInConversation(w.alice.id, w.topic.id)).toBe(true);
    await loginAs(w.spaceAdmin.id);
    expect((await patch(w.topic.id, { postingPolicy: "ADMINS" })).status).toBe(200);
    expect(await canPostInConversation(w.alice.id, w.topic.id)).toBe(false);
    expect(await canReadConversation(w.alice.id, w.topic.id)).toBe(true);
    expect(await canPostInConversation(w.spaceAdmin.id, w.topic.id)).toBe(true);
  });

  it("a plain member changes none of it (403)", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    expect((await patch(w.topic.id, { restricted: true, memberIds: [w.alice.id] })).status).toBe(403);
    expect((await patch(w.topic.id, { postingPolicy: "ADMINS" })).status).toBe(403);
  });
});
