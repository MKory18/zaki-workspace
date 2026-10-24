import { describe, expect, it } from "vitest";
import { canManageWorkspaceMembers } from "@/server/services/access";
import { pushNotification, pushNotificationToMany } from "@/server/notify";
import { conversationDetail } from "@/server/chat/topics";
import { listDms } from "@/server/chat/dm";
import * as projectRoute from "@/app/api/projects/[id]/route";
import { call, db, loginAs, makeProject } from "./helpers";
import { makeSpaceWorld } from "./spaces-helpers";

/**
 * Cross-cutting checks found while putting Phase 1 together (the reports of the agents that built
 * the pieces). Each one failed before its fix.
 */
describe("canManageWorkspaceMembers: the owner and space admins, never a guest", () => {
  it("an org GUEST with a leftover workspace ADMIN row cannot manage the space's people", async () => {
    const w = await makeSpaceWorld({ guest: "ADMIN" });
    expect(await canManageWorkspaceMembers(w.guest.id, w.ws.id)).toBe(false);
  });

  it("the owner can, with no row at all", async () => {
    const w = await makeSpaceWorld({ member: "MEMBER" });
    expect(await canManageWorkspaceMembers(w.owner.id, w.ws.id)).toBe(true);
  });

  it("an org ADMIN can only when they are in the space (rank gives no space), then whatever their row says", async () => {
    const without = await makeSpaceWorld({ member: "MEMBER" });
    expect(await canManageWorkspaceMembers(without.admin.id, without.ws.id)).toBe(false);
    const withRow = await makeSpaceWorld({ admin: "MEMBER" });
    expect(await canManageWorkspaceMembers(withRow.admin.id, withRow.ws.id)).toBe(true);
  });

  it("a space ADMIN row manages, a plain MEMBER row does not", async () => {
    const w = await makeSpaceWorld({ member: "ADMIN", lead: "MEMBER" });
    expect(await canManageWorkspaceMembers(w.member.id, w.ws.id)).toBe(true);
    expect(await canManageWorkspaceMembers(w.lead.id, w.ws.id)).toBe(false);
  });
});

describe("notifications go only to people who are in", () => {
  it("a suspended or offboarded person gets nothing new, a single one or in a group", async () => {
    const w = await makeSpaceWorld({ member: "MEMBER", lead: "MEMBER" });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.lead.id } },
      data: { status: "SUSPENDED" },
    });
    await pushNotification({ userId: w.lead.id, type: "x", title: "single" });
    await pushNotificationToMany([w.lead.id, w.member.id], { type: "x", title: "group", body: "secret follow-up" });
    expect(await db.notification.count({ where: { userId: w.lead.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: w.member.id, title: "group" } })).toBe(1);
  });

  it("an active person still gets theirs", async () => {
    const w = await makeSpaceWorld({ member: "MEMBER" });
    await pushNotification({ userId: w.member.id, type: "x", title: "single" });
    expect(await db.notification.count({ where: { userId: w.member.id, title: "single" } })).toBe(1);
  });
});

describe("project status through the API", () => {
  it("accepts every real status (AT_RISK, ARCHIVED too) and ignores a made-up one instead of failing", async () => {
    const w = await makeSpaceWorld({ member: "ADMIN" });
    const { project } = await makeProject(w.ws.id);
    await loginAs(w.member.id);
    const atRisk = await call(projectRoute.PATCH, { method: "PATCH", params: { id: project.id }, body: { status: "AT_RISK" } });
    expect(atRisk.status).toBe(200);
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe("AT_RISK");
    const bogus = await call(projectRoute.PATCH, { method: "PATCH", params: { id: project.id }, body: { status: "CANCELED" } });
    expect(bogus.status).toBe(200);
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe("AT_RISK");
  });
});

describe("group chats list only the people who are in", () => {
  it("a suspended person is not among the members shown to the others", async () => {
    const w = await makeSpaceWorld({ member: "MEMBER", lead: "MEMBER" });
    const conv = await db.conversation.create({
      data: {
        orgId: w.org.id,
        kind: "GROUP",
        title: "Team",
        members: { create: [{ userId: w.member.id }, { userId: w.lead.id }, { userId: w.admin.id }] },
      },
    });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.lead.id } },
      data: { status: "SUSPENDED" },
    });
    // the live chat (src/server/chat): the conversation screen and the chat list (this case was written
    // against the retired services/chat.ts and keeps its claim)
    const ctx = { orgId: w.org.id, orgRole: "MEMBER" as const, userId: w.member.id };
    const detail = await conversationDetail(ctx, conv.id);
    expect(detail.members!.map((m) => m.id).sort()).toEqual([w.admin.id, w.member.id].sort());
    expect((await listDms(ctx)).some((c) => c.id === conv.id)).toBe(true);
  });
});
