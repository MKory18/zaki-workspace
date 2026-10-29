import { describe, expect, it } from "vitest";
import { spacesOverview } from "@/server/services/spaces-overview";
import { db, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { actorOf } from "./today-helpers";

/**
 * The number beside a space in «كل المساحات» is the people who WORK there (Phase B of the review).
 *
 * A suspended person keeps their `OrganizationMember` row and, for a while, their `WorkspaceMember`
 * row too: suspending does not delete it (offboarding does — `accounts.ts`). Counting workspace rows
 * alone therefore showed a space with seven people when one of them had been suspended, and the
 * owner had no way to tell the difference. Every other list of people in the code filters
 * `status: ACTIVE`; this one did not.
 *
 * A GUEST is a person of the space (an external partner) and still counts: the fix is the person's
 * status, not their rank.
 */

async function spacesWorld() {
  const team = await makeTeam();
  const ws = await makeWorkspace(
    team.org.id,
    [{ userId: team.admin.id }, { userId: team.member.id }, { userId: team.guest.id, role: "GUEST" }],
    "مساحة العمل",
  );
  return { ...team, ws };
}

/** The number on that space's card, as the OWNER sees it. */
async function memberCountOf(userId: string, workspaceId: string) {
  const cards = await spacesOverview(await actorOf(userId));
  return cards.find((c) => c.id === workspaceId)?.members;
}

describe("«كل المساحات» counts the people who are actually there", () => {
  it("a suspended person stops counting as a member of the space", async () => {
    const w = await spacesWorld();
    expect(await memberCountOf(w.owner.id, w.ws.id)).toBe(3);

    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { status: "SUSPENDED" },
    });
    expect(await memberCountOf(w.owner.id, w.ws.id)).toBe(2);
  });

  it("an offboarded person does not count either, while their space row is still there", async () => {
    const w = await spacesWorld();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } },
      data: { status: "OFFBOARDED" },
    });
    // the row an offboarding normally deletes is still here: the count must not trust it
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id } })).toBe(3);
    expect(await memberCountOf(w.owner.id, w.ws.id)).toBe(2);
  });

  it("the partner of a space is a person of it: a GUEST still counts", async () => {
    const w = await spacesWorld();
    const cards = await spacesOverview(await actorOf(w.owner.id));
    const card = cards.find((c) => c.id === w.ws.id);
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: "Partner" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: guest.id, role: "GUEST" } });
    const after = (await spacesOverview(await actorOf(w.owner.id))).find((c) => c.id === w.ws.id);
    expect(after!.members).toBe(card!.members + 1);
  });
});
