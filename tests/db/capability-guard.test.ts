import { describe, expect, it } from "vitest";
import { assertCapability, holdsCapability } from "@/server/services/active-people";
import { db, makeTeam, makeUser } from "./helpers";

/**
 * The capability guard the services share, on a PARTNER (an OWNER who is not the primary owner).
 *
 * `effectiveCapabilities` treats the two kinds of owner differently: the primary owner holds
 * everything, a partner holds everything the primary owner has not taken away. That difference is
 * decided by `primaryOwner`, and the guard re-reads the member row from the database rather than
 * trusting the session. Leaving that column out of the read made every partner look like the primary
 * owner, so a capability the owner had switched off came back the moment a service asked
 * (security review C2: the amount on an opportunity, and every other `assertCapability` caller).
 */
async function partnerWorld() {
  const team = await makeTeam();
  const partner = await makeUser({ orgId: team.org.id, name: "Partner" });
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: team.org.id, userId: partner.id } },
    data: { role: "OWNER", primaryOwner: false, revokedCapabilities: ["crm.edit"] },
  });
  return { ...team, partner };
}

describe("the shared capability guard", () => {
  it("honours a partner's removed box and keeps the one he still holds", async () => {
    const w = await partnerWorld();
    const ctx = { orgId: w.org.id, userId: w.partner.id };

    await expect(assertCapability(ctx, "crm.edit")).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "insufficient_role",
    });
    await expect(assertCapability(ctx, "crm.view")).resolves.toBeUndefined();
    expect(await holdsCapability(ctx, "crm.edit")).toBe(false);
    expect(await holdsCapability(ctx, "crm.view")).toBe(true);
  });

  it("the primary owner holds everything", async () => {
    const w = await partnerWorld();
    expect(await holdsCapability({ orgId: w.org.id, userId: w.owner.id }, "crm.edit")).toBe(true);
    expect(await holdsCapability({ orgId: w.org.id, userId: w.owner.id }, "archive.view")).toBe(true);
  });

  it("a suspended member holds nothing and is not a member at all", async () => {
    const w = await makeTeam();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { status: "SUSPENDED" },
    });
    const ctx = { orgId: w.org.id, userId: w.member.id };
    expect(await holdsCapability(ctx, "crm.view")).toBe(false);
    await expect(assertCapability(ctx, "crm.view")).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "not_org_member",
    });
  });

  it("an external partner (GUEST) holds nothing, whatever was stored for them", async () => {
    const w = await makeTeam();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.guest.id } },
      data: { capabilities: ["prices.view", "crm.view"] },
    });
    expect(await holdsCapability({ orgId: w.org.id, userId: w.guest.id }, "prices.view")).toBe(false);
    expect(await holdsCapability({ orgId: w.org.id, userId: w.guest.id }, "crm.view")).toBe(false);
  });
});
