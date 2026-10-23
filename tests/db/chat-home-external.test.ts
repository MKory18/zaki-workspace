import { afterAll, describe, expect, it } from "vitest";
import { chatHome } from "@/server/chat/home";
import { db, makeOrg, makeTeam, makeUser, makeWorkspace } from "./helpers";

afterAll(async () => { await db.$disconnect(); });

describe("chat home space partner and moderation flags", () => {
  it("marks only spaces with an active same-organization guest and derives moderation capability", async () => {
    const team = await makeTeam();
    const admin = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Space admin" });
    const staff = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Staff" });
    const suspended = await makeUser({ orgId: team.org.id, role: "GUEST", name: "Suspended guest" });
    const inactive = await makeUser({ orgId: team.org.id, role: "GUEST", name: "Offboarded guest" });
    const otherOrg = await makeOrg();
    const foreignGuest = await makeUser({ orgId: otherOrg.id, role: "GUEST" });
    const ws = await makeWorkspace(team.org.id, [
      { userId: team.owner.id }, { userId: admin.id, role: "ADMIN" }, { userId: staff.id },
      { userId: team.guest.id, role: "GUEST" }, { userId: suspended.id, role: "GUEST" },
      { userId: inactive.id, role: "GUEST" }, { userId: foreignGuest.id, role: "GUEST" },
    ]);
    await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: team.org.id, userId: suspended.id } }, data: { status: "SUSPENDED" } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: team.org.id, userId: inactive.id } }, data: { status: "OFFBOARDED" } });

    const homeFor = async (userId: string) => (await chatHome({ orgId: team.org.id, userId, orgRole: "MEMBER" })).spaces[0]!;
    expect((await homeFor(admin.id))).toMatchObject({ hasExternal: true, canModerate: true });
    expect((await homeFor(staff.id))).toMatchObject({ hasExternal: true, canModerate: false });
    expect((await homeFor(team.guest.id))).toMatchObject({ hasExternal: true, canModerate: false });
    expect((await homeFor(team.owner.id))).toMatchObject({ hasExternal: true, canModerate: true });

    // With the only active guest removed, inactive/suspended and foreign-org guest rows do not count.
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: team.org.id, userId: team.guest.id } }, data: { status: "SUSPENDED" } });
    expect((await homeFor(admin.id)).hasExternal).toBe(false);
  });
});
