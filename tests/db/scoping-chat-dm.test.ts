import { describe, expect, it } from "vitest";
import type { OrgRole } from "@prisma/client";
import { openDm } from "@/server/chat/dm";

/**
 * The live DM door (src/server/chat/dm.ts, behind POST /api/chat/dm). These cases were written against
 * the retired services/chat.ts and moved here unchanged in what they prove; the error keys are the live
 * ones (a guest on either side is chat.guest_forbidden, nobody outside the company is chat.e.not_found).
 */
const createDm = async (ctx: { orgId: string; orgRole: OrgRole; userId: string }, otherId: string) => (await openDm(ctx, otherId)).id;
import { db, makeOrg, makeTeam, makeUser } from "./helpers";
import { joinOrg } from "./scoping-helpers";

const ctxOf = (orgId: string, userId: string, orgRole: OrgRole = "MEMBER") => ({ orgId, orgRole, userId });

const dmsBetween = (a: string, b: string) =>
  db.conversation.findMany({
    where: { kind: "DM", AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }] },
    select: { id: true, orgId: true, members: { select: { userId: true } } },
  });

describe("openDm: a DM stays inside one organization and never reaches a guest", () => {
  it("opens one DM per pair, whoever starts it, bound to the caller's org", async () => {
    const t = await makeTeam();
    const other = await makeUser({ orgId: t.org.id, role: "MEMBER" });
    const first = await createDm(ctxOf(t.org.id, t.member.id), other.id);
    const again = await createDm(ctxOf(t.org.id, t.member.id), other.id);
    const reversed = await createDm(ctxOf(t.org.id, other.id), t.member.id);
    expect(again).toBe(first);
    expect(reversed).toBe(first);
    const rows = await dmsBetween(t.member.id, other.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.orgId).toBe(t.org.id);
    expect(rows[0]!.members.map((m) => m.userId).sort()).toEqual([t.member.id, other.id].sort());
  });

  it("refuses a GUEST as the other person, and creates nothing", async () => {
    const t = await makeTeam();
    await expect(createDm(ctxOf(t.org.id, t.member.id), t.guest.id)).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "chat.guest_forbidden",
    });
    expect(await dmsBetween(t.member.id, t.guest.id)).toHaveLength(0);
    // an ADMIN opening a DM with a guest is refused the same way
    await expect(createDm(ctxOf(t.org.id, t.admin.id, "ADMIN"), t.guest.id)).rejects.toMatchObject({
      name: "ForbiddenError",
    });
    expect(await dmsBetween(t.admin.id, t.guest.id)).toHaveLength(0);
  });

  it("still refuses a GUEST caller (the existing guard)", async () => {
    const t = await makeTeam();
    await expect(createDm(ctxOf(t.org.id, t.guest.id, "GUEST"), t.member.id)).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "chat.guest_forbidden",
    });
    expect(await dmsBetween(t.guest.id, t.member.id)).toHaveLength(0);
  });

  it("refuses a person who is not in the caller's organization", async () => {
    const a = await makeTeam();
    const b = await makeTeam();
    await expect(createDm(ctxOf(a.org.id, a.member.id), b.member.id)).rejects.toMatchObject({
      name: "NotFoundError",
      message: "chat.e.not_found",
    });
    expect(await dmsBetween(a.member.id, b.member.id)).toHaveLength(0);
    // an unknown id is refused the same way
    await expect(createDm(ctxOf(a.org.id, a.member.id), "no-such-user")).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });

  it("refuses a DM with yourself", async () => {
    const t = await makeTeam();
    await expect(createDm(ctxOf(t.org.id, t.member.id), t.member.id)).rejects.toMatchObject({
      name: "ForbiddenError",
    });
    expect(await dmsBetween(t.member.id, t.member.id)).toHaveLength(0);
  });

  it("never hands back a conversation that belongs to another organization", async () => {
    const orgA = await makeOrg();
    const orgB = await makeOrg();
    const u = await makeUser({ orgId: orgA.id, role: "MEMBER" });
    const p = await makeUser({ orgId: orgA.id, role: "MEMBER" });
    await joinOrg(u.id, orgB.id, "MEMBER");
    await joinOrg(p.id, orgB.id, "MEMBER");

    // the pair already talks inside org B
    const inB = await createDm(ctxOf(orgB.id, u.id), p.id);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: inB }, select: { orgId: true } })).orgId).toBe(orgB.id);

    // opening a DM in org A must not return org B's conversation — it gets its own
    const inA = await createDm(ctxOf(orgA.id, u.id), p.id);
    expect(inA).not.toBe(inB);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: inA }, select: { orgId: true } })).orgId).toBe(orgA.id);

    // and each org keeps finding its own
    expect(await createDm(ctxOf(orgA.id, u.id), p.id)).toBe(inA);
    expect(await createDm(ctxOf(orgB.id, p.id), u.id)).toBe(inB);
    expect(await dmsBetween(u.id, p.id)).toHaveLength(2);
  });

  it("the org filter holds whichever organization opened its DM first", async () => {
    const orgA = await makeOrg();
    const orgB = await makeOrg();
    const u = await makeUser({ orgId: orgB.id, role: "ADMIN" });
    const p = await makeUser({ orgId: orgB.id, role: "MEMBER" });
    await joinOrg(u.id, orgA.id, "OWNER");
    await joinOrg(p.id, orgA.id, "MEMBER");
    const inA = await createDm(ctxOf(orgA.id, u.id, "OWNER"), p.id);
    const inB = await createDm(ctxOf(orgB.id, u.id, "ADMIN"), p.id);
    expect(inB).not.toBe(inA);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: inB }, select: { orgId: true } })).orgId).toBe(orgB.id);
  });
});
