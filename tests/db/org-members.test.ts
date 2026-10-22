import { describe, expect, it } from "vitest";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import * as membersRoute from "@/app/api/organizations/[id]/members/route";
import { call, db, loginAs, logout, makeTeam } from "./helpers";

const NEW_PASSWORD = "BrandNew-pass1";

async function hashOf(userId: string): Promise<string> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  return u.passwordHash;
}

describe("organization members: who may reset whose password", () => {
  it("anonymous callers and plain members cannot use the roster at all", async () => {
    const { org, member } = await makeTeam();
    logout();
    expect((await call(membersRoute.GET, { params: { id: org.id } })).status).toBe(401);
    await loginAs(member.id);
    expect((await call(membersRoute.GET, { params: { id: org.id } })).status).toBe(403);
  });

  it("an ADMIN cannot reset the OWNER's password", async () => {
    const { org, owner, admin } = await makeTeam();
    const before = await hashOf(owner.id);
    await loginAs(admin.id);
    const res = await call(memberRoute.PATCH, {
      method: "PATCH",
      params: { id: org.id, userId: owner.id },
      body: { password: NEW_PASSWORD },
    });
    expect(res.status).toBe(403);
    expect(await hashOf(owner.id)).toBe(before);
  });

  it("an ADMIN cannot reset another ADMIN's password", async () => {
    const { org, admin } = await makeTeam();
    const { makeUser } = await import("./helpers");
    const otherAdmin = await makeUser({ orgId: org.id, role: "ADMIN" });
    const before = await hashOf(otherAdmin.id);
    await loginAs(admin.id);
    const res = await call(memberRoute.PATCH, {
      method: "PATCH",
      params: { id: org.id, userId: otherAdmin.id },
      body: { password: NEW_PASSWORD },
    });
    expect(res.status).toBe(403);
    expect(await hashOf(otherAdmin.id)).toBe(before);
  });

  it("an ADMIN can still reset a plain member's password", async () => {
    const { org, admin, member } = await makeTeam();
    const before = await hashOf(member.id);
    await loginAs(admin.id);
    const res = await call(memberRoute.PATCH, {
      method: "PATCH",
      params: { id: org.id, userId: member.id },
      body: { password: NEW_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(await hashOf(member.id)).not.toBe(before);
  });

  it("the OWNER can reset an ADMIN's password", async () => {
    const { org, owner, admin } = await makeTeam();
    const before = await hashOf(admin.id);
    await loginAs(owner.id);
    const res = await call(memberRoute.PATCH, {
      method: "PATCH",
      params: { id: org.id, userId: admin.id },
      body: { password: NEW_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(await hashOf(admin.id)).not.toBe(before);
  });

  it("nobody can reset a password for a user of a different organization", async () => {
    const a = await makeTeam();
    const b = await makeTeam();
    const before = await hashOf(b.member.id);
    await loginAs(a.owner.id);
    const res = await call(memberRoute.PATCH, {
      method: "PATCH",
      params: { id: a.org.id, userId: b.member.id },
      body: { password: NEW_PASSWORD },
    });
    expect(res.status).toBe(404);
    expect(await hashOf(b.member.id)).toBe(before);
  });
});
