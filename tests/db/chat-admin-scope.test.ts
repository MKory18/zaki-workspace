import { describe, expect, it } from "vitest";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as topicMembersRoute from "@/app/api/chat/topics/[id]/members/route";
import * as orgMemberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import { addOrgToHq, hqSpaceIdOf, hqTopicIdOf } from "@/server/chat/hq";
import { canModerate, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function canModerateAs(userId: string, orgId: string, conversationId: string) {
  return canModerate(await loadConversationFacts(userId, conversationId), await loadOrgFacts(userId, orgId));
}

describe("chat: an org ADMIN moderates only the spaces where they are a space ADMIN (design §26)", () => {
  it("not in the space: cannot delete others' messages or add people (themselves included) to a restricted topic", async () => {
    const t = await makeTeam();
    const lead = await makeUser({ orgId: t.org.id, name: "Space lead" });
    const ws = await makeWorkspace(t.org.id, [{ userId: lead.id, role: "ADMIN" }, { userId: t.member.id }]);
    const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
    const restricted = await db.conversation.create({
      data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "Private", restricted: true, members: { create: [{ userId: lead.id }] } },
    });
    const msg = await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: topic.id, authorId: t.member.id, body: "hello" } });

    expect(await canModerateAs(t.admin.id, t.org.id, topic.id)).toBe(false);
    await loginAs(t.admin.id);
    expect((await call(messageRoute.DELETE, { method: "DELETE", params: { id: msg.id } })).status).toBeGreaterThanOrEqual(400);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: msg.id } })).deletedAt).toBeNull();
    expect((await call(topicMembersRoute.POST, { params: { id: restricted.id }, body: { userId: t.admin.id } })).status).toBeGreaterThanOrEqual(400);
    expect(await db.conversationMember.count({ where: { conversationId: restricted.id, userId: t.admin.id } })).toBe(0);
  });

  it("a plain MEMBER of a space cannot moderate a restricted topic they are not in, even as an org ADMIN", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.admin.id }]);
    const restricted = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "Private", restricted: true } });
    expect(await canModerateAs(t.admin.id, t.org.id, restricted.id)).toBe(false);
  });

  it("the space's own ADMIN (and the OWNER) still moderate it", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.admin.id, role: "ADMIN" }, { userId: t.member.id }]);
    const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
    const msg = await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: topic.id, authorId: t.member.id, body: "hello" } });
    expect(await canModerateAs(t.owner.id, t.org.id, topic.id)).toBe(true);
    await loginAs(t.admin.id);
    expect((await call(messageRoute.DELETE, { method: "DELETE", params: { id: msg.id } })).status).toBeLessThan(300);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: msg.id } })).deletedAt).not.toBeNull();
  });
});

describe("accounts: the HQ space role follows the org rank (review B4)", () => {
  const hqRole = (orgId: string, userId: string) =>
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: hqSpaceIdOf(orgId), userId } }, select: { role: true } });

  it("an ADMIN demoted to MEMBER stops moderating HQ; a MEMBER promoted to ADMIN starts", async () => {
    const t = await makeTeam();
    await addOrgToHq(t.org.id);
    const general = hqTopicIdOf(t.org.id, "general");
    expect((await hqRole(t.org.id, t.admin.id))?.role).toBe("ADMIN");
    expect(await canModerateAs(t.admin.id, t.org.id, general)).toBe(true);

    await loginAs(t.owner.id);
    const demote = await call(orgMemberRoute.PATCH, { method: "PATCH", params: { id: t.org.id, userId: t.admin.id }, body: { role: "MEMBER" } });
    expect(demote.status).toBe(200);
    expect((await hqRole(t.org.id, t.admin.id))?.role).toBe("MEMBER");
    expect(await canModerateAs(t.admin.id, t.org.id, general)).toBe(false);

    const promote = await call(orgMemberRoute.PATCH, { method: "PATCH", params: { id: t.org.id, userId: t.member.id }, body: { role: "ADMIN" } });
    expect(promote.status).toBe(200);
    expect((await hqRole(t.org.id, t.member.id))?.role).toBe("ADMIN");
    expect(await canModerateAs(t.member.id, t.org.id, general)).toBe(true);
  });
});
