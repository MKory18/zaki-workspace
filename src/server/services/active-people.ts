import { db, type DbClient } from "@/server/db";
import { ForbiddenError } from "@/server/auth";
import { can, type Capability } from "@/server/policy/capabilities";

/**
 * "Nobody who was suspended or removed still counts."
 *
 * A suspended or offboarded member keeps their OrganizationMember row (history, authorship), so a
 * query that reads that table without looking at `status` quietly treats them as present again.
 * These are the few look-ups the services share; every one of them knows only ACTIVE members
 * (tests/active-membership-guard.test.ts fails for any membership read in src/ that forgets to).
 */

/** The member's row (rank and switches included), only while it is ACTIVE; null for none, suspended or offboarded. */
export async function activeMember(orgId: string, userId: string, client: DbClient = db) {
  const member = await client.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { role: true, status: true, capabilities: true, revokedCapabilities: true },
  });
  return member && member.status === "ACTIVE" ? member : null;
}

/**
 * Work can only be handed to somebody who is in the organization AND active in it. Two answers, so
 * the person at the screen learns which it is: `assignee.not_member` (not in this organization at
 * all) or `assignee.not_active` (suspended or offboarded).
 */
export async function assertActiveAssignee(orgId: string, userId: string, client: DbClient = db): Promise<void> {
  const row = await client.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { status: true },
  });
  if (!row) throw new ForbiddenError("assignee.not_member");
  if (row.status !== "ACTIVE") throw new ForbiddenError("assignee.not_active");
}

/**
 * Throws 403 `insufficient_role` unless this person holds the capability (a guest holds none), and
 * `not_org_member` unless they are an ACTIVE member of the organization at all. For callers that
 * were handed a context (`{ orgId, userId }`) rather than the signed-in `Actor`.
 */
export async function assertCapability(
  ctx: { orgId: string; userId: string },
  capability: Capability,
  client: DbClient = db,
): Promise<void> {
  const member = await activeMember(ctx.orgId, ctx.userId, client);
  if (!member) throw new ForbiddenError("not_org_member");
  if (!can(member, capability)) throw new ForbiddenError("insufficient_role");
}
