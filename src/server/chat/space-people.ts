import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { HQ_SYSTEM_KEY } from "@/server/chat/hq";

/**
 * THE PEOPLE OF A SPACE — who you meet inside the space you are in (the owner's decision, 2026-10-25: people and
 * private messages only among colleagues who share the space; a space is like a separate site): the ACTIVE people
 * with a row in it, and the company's OWNER, who is in every space without a row.
 */
export function spacePeopleWhere(orgId: string, spaceId: string): Prisma.OrganizationMemberWhereInput {
  return {
    organizationId: orgId,
    status: "ACTIVE",
    OR: [{ role: "OWNER" }, { user: { workspaceLinks: { some: { workspaceId: spaceId } } } }],
  };
}

/** Is this person one of the space's people? */
export async function isOfSpace(orgId: string, spaceId: string, userId: string): Promise<boolean> {
  return (await db.organizationMember.count({ where: { AND: [spacePeopleWhere(orgId, spaceId)], userId, status: "ACTIVE" } })) > 0;
}

/** Is the space «الشركة» (HQ)? The private messages from before spaces existed live there. */
export async function isHqSpace(spaceId: string | null | undefined): Promise<boolean> {
  if (!spaceId) return false;
  const ws = await db.workspace.findUnique({ where: { id: spaceId }, select: { systemKey: true } });
  return ws?.systemKey === HQ_SYSTEM_KEY;
}
