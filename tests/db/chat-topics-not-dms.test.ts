import { describe, expect, it } from "vitest";
import * as conversationsRoute from "@/app/api/chat/conversations/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as conversationMessagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as joinRoute from "@/app/api/chat/conversations/[id]/join/route";
import * as topicRoute from "@/app/api/chat/topics/[id]/route";
import * as topicMembersRoute from "@/app/api/chat/topics/[id]/members/route";
import { canModerate, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const SECRET = "DM secret: my salary is 900";

/** A member and an admin with a DM between them, a bystander, and an ordinary topic in a space. */
async function world() {
  const team = await makeTeam();
  const bystander = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Bystander" });
  await loginAs(team.member.id);
  const dm = await call(conversationsRoute.POST, { body: { kind: "DM", userId: team.admin.id } });
  expect(dm.status).toBe(201);
  const dmId = dm.json?.["id"] as string;
  expect((await call(conversationMessagesRoute.POST, { params: { id: dmId }, body: { body: SECRET } })).status).toBe(201);
  const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: bystander.id }]);
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "General", restricted: true } });
  return { ...team, bystander, dmId, topicId: topic.id };
}

const rowsOf = async (conversationId: string) =>
  (await db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })).map((r) => r.userId).sort();

describe("chat: the topic doors never open somebody else's DM", () => {
  it("the OWNER cannot join a DM, add a third person to it, remove one of its two people, rename or close it", async () => {
    const w = await world();
    const before = await rowsOf(w.dmId);
    await loginAs(w.owner.id);
    const url = `http://localhost/api/chat/conversations/${w.dmId}`;

    expect((await call(joinRoute.POST, { url, params: { id: w.dmId } })).status).toBe(404);
    expect((await call(topicMembersRoute.POST, { params: { id: w.dmId }, body: { userId: w.bystander.id } })).status).toBe(404);
    expect((await call(topicMembersRoute.DELETE, { method: "DELETE", url: `http://localhost/api/chat/topics/${w.dmId}/members?userId=${w.member.id}`, params: { id: w.dmId } })).status).toBe(404);
    expect((await call(topicRoute.PATCH, { method: "PATCH", params: { id: w.dmId }, body: { title: "Renamed" } })).status).toBe(404);
    expect((await call(topicRoute.PATCH, { method: "PATCH", params: { id: w.dmId }, body: { closed: true } })).status).toBe(404);

    expect(await rowsOf(w.dmId)).toEqual(before);
    const dm = await db.conversation.findUniqueOrThrow({ where: { id: w.dmId } });
    expect(dm.title).toBeNull();
    expect(dm.closedAt).toBeNull();
    expect(await db.chatMessage.count({ where: { conversationId: w.dmId, kind: "SYSTEM" } })).toBe(0);
  });

  it("so the bystander the owner tried to add still cannot read the DM", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await call(topicMembersRoute.POST, { params: { id: w.dmId }, body: { userId: w.bystander.id } });
    await loginAs(w.bystander.id);
    const res = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.dmId}`, params: { id: w.dmId } });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(SECRET);
  });

  it("nobody moderates a DM, the OWNER included (policy)", async () => {
    const w = await world();
    for (const who of [w.owner, w.admin, w.member]) {
      const facts = await loadConversationFacts(who.id, w.dmId);
      expect(canModerate(facts, await loadOrgFacts(who.id, w.org.id)), who.name).toBe(false);
    }
  });

  it("the same doors still work on a real topic (the owner adds the bystander to a restricted topic)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await call(topicMembersRoute.POST, { params: { id: w.topicId }, body: { userId: w.bystander.id } })).status).toBe(201);
    expect(await rowsOf(w.topicId)).toContain(w.bystander.id);
    const url = `http://localhost/api/chat/conversations/${w.topicId}`;
    expect((await call(joinRoute.POST, { url, params: { id: w.topicId } })).status).toBe(200);
  });
});
