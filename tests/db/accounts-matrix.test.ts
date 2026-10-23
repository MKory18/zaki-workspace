import { describe, expect, it } from "vitest";
import type { OrgRole } from "@prisma/client";
import { db, loginAs, makeTeam, makeUser } from "./helpers";
import { accountsApi, grantCapabilities, reason, username } from "./accounts-helpers";

/**
 * The rank rules, proven through the real route handlers: every caller rank that can hold
 * `users.manage` (OWNER and ADMIN by default; a LEAD and a MEMBER who were given it) against every
 * target rank, for each action. The pure version of the same matrix is tests/org-members-logic.test.ts.
 */

type Actor = "OWNER" | "ADMIN" | "LEAD" | "MEMBER";
const TARGETS: OrgRole[] = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"];

// strictly below one's own rank: a peer is never "below" (review B, M1)
const ADMINISTER: Record<Actor, boolean[]> = {
  OWNER: [false, true, true, true, true],
  ADMIN: [false, false, true, true, true],
  LEAD: [false, false, false, true, true],
  MEMBER: [false, false, false, false, true],
};

const CREATE: Record<Actor, number[]> = {
  // creating: OWNER, ADMIN, LEAD, MEMBER, GUEST
  OWNER: [422, 201, 201, 201, 201],
  ADMIN: [422, 403, 201, 201, 201],
  LEAD: [422, 403, 403, 201, 201],
  MEMBER: [422, 403, 403, 403, 201],
};

/** One company where each caller has somebody of every rank to act on (never themselves). */
async function company() {
  const { org, owner, admin, member, guest } = await makeTeam();
  const lead = await makeUser({ orgId: org.id, role: "LEAD", name: "Lead" });
  const actors: Record<Actor, string> = { OWNER: owner.id, ADMIN: admin.id, LEAD: lead.id, MEMBER: member.id };
  await grantCapabilities(org.id, lead.id, ["users.manage"]);
  await grantCapabilities(org.id, member.id, ["users.manage"]);
  const targets: Record<OrgRole, string> = {
    OWNER: owner.id,
    ADMIN: (await makeUser({ orgId: org.id, role: "ADMIN", name: "Admin 2" })).id,
    LEAD: (await makeUser({ orgId: org.id, role: "LEAD", name: "Lead 2" })).id,
    MEMBER: (await makeUser({ orgId: org.id, role: "MEMBER", name: "Member 2" })).id,
    GUEST: guest.id,
  };
  return { org, actors, targets };
}

async function backToActive(orgId: string, userId: string) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: { status: "ACTIVE" } });
}

describe("the rank matrix over HTTP", () => {
  for (const actor of Object.keys(ADMINISTER) as Actor[]) {
    it(`${actor} with users.manage: edit, suspend, reset password and sign out exactly the ranks it may administer`, async () => {
      const { org, actors, targets } = await company();
      await loginAs(actors[actor]);
      for (const [i, target] of TARGETS.entries()) {
        const expected = ADMINISTER[actor][i] ? 200 : 403;
        const userId = targets[target];
        const cell = `${actor} -> ${target}`;

        const edit = await accountsApi.update(org.id, userId, { jobTitle: `Set by ${actor}` });
        expect(edit.status, `edit ${cell}`).toBe(expected);
        const signOut = await accountsApi.logout(org.id, userId);
        expect(signOut.status, `logout ${cell}`).toBe(expected);
        const reset = await accountsApi.password(org.id, userId);
        expect(reset.status, `password ${cell}`).toBe(expected);
        const suspend = await accountsApi.status(org.id, userId, { action: "suspend" });
        expect(suspend.status, `suspend ${cell}`).toBe(expected);
        if (expected === 200) {
          await backToActive(org.id, userId);
        } else {
          // the refusal names its reason: the OWNER acting on the OWNER is acting on themselves
          const why = actor === "OWNER" && target === "OWNER" ? "accounts.self_denied" : "orgm.role_denied";
          for (const res of [edit, signOut, reset, suspend]) expect(reason(res), cell).toBe(why);
          const row = await db.organizationMember.findUniqueOrThrow({
            where: { organizationId_userId: { organizationId: org.id, userId } },
            select: { status: true, user: { select: { jobTitle: true } } },
          });
          expect(row.status, cell).toBe("ACTIVE");
          expect(row.user.jobTitle, cell).not.toBe(`Set by ${actor}`);
        }
      }
    });

    it(`${actor} with users.manage creates exactly the ranks it may create`, async () => {
      const { org, actors } = await company();
      await loginAs(actors[actor]);
      for (const [i, role] of TARGETS.entries()) {
        const res = await accountsApi.create(org.id, { name: `New ${role}`, username: username(role.toLowerCase()), role });
        expect(res.status, `${actor} creates ${role}`).toBe(CREATE[actor][i]);
      }
    });
  }

  it("without users.manage, a MEMBER, a LEAD and a GUEST are refused everything", async () => {
    const { org, targets } = await company();
    const plainLead = await makeUser({ orgId: org.id, role: "LEAD" });
    const plainMember = await makeUser({ orgId: org.id, role: "MEMBER" });
    for (const callerId of [plainLead.id, plainMember.id, targets.GUEST]) {
      await loginAs(callerId);
      const answers = [
        await accountsApi.list(org.id),
        await accountsApi.create(org.id, { name: "Nope", username: username(), role: "GUEST" }),
        await accountsApi.update(org.id, targets.MEMBER, { jobTitle: "nope" }),
        await accountsApi.status(org.id, targets.MEMBER, { action: "suspend" }),
        await accountsApi.password(org.id, targets.MEMBER),
        await accountsApi.logout(org.id, targets.MEMBER),
        await accountsApi.remove(org.id, targets.MEMBER),
      ];
      for (const res of answers) {
        expect(res.status).toBe(403);
        expect(reason(res)).toBe("insufficient_role");
      }
    }
    expect((await db.organizationMember.findFirstOrThrow({ where: { userId: targets.MEMBER } })).status).toBe("ACTIVE");
  });
});
