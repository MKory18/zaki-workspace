import type { OrgRole } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, requireUser } from "@/server/auth";
import { can, effectiveCapabilities, type Capability } from "./capabilities";

/**
 * Who is making this request, as far as the rules are concerned: the person, the organization
 * they work in (their oldest ACTIVE membership), their rank and what they may do.
 */
export interface Actor {
  userId: string;
  orgId: string;
  role: OrgRole;
  caps: ReadonlySet<Capability>;
  isOwner: boolean;
  /** The company's primary owner: the only one who makes or unmakes another OWNER (absent: not him). */
  isPrimaryOwner?: boolean;
  /** An external partner: sees only what is shared with them, no prices, no staff directory. */
  isExternal: boolean;
}

export async function requireActor(opts: { allowPending?: boolean } = {}): Promise<Actor> {
  const user = await requireUser(opts);
  const member = await db.organizationMember.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true, capabilities: true, revokedCapabilities: true, primaryOwner: true },
  });
  if (!member) throw new ForbiddenError("not_org_member");
  return {
    userId: user.id,
    orgId: member.organizationId,
    role: member.role,
    caps: effectiveCapabilities(member),
    isOwner: member.role === "OWNER",
    isPrimaryOwner: member.role === "OWNER" && member.primaryOwner,
    isExternal: member.role === "GUEST",
  };
}

export function actorCan(actor: Pick<Actor, "caps">, capability: Capability): boolean {
  return actor.caps.has(capability);
}

/** 403 `insufficient_role` unless the actor holds the capability (a guest holds none). */
export function assertCan(actor: Pick<Actor, "caps">, capability: Capability): void {
  if (!actorCan(actor, capability)) throw new ForbiddenError("insufficient_role");
}

/** The capability check for a member row read from the database (not the signed-in actor). */
export { can };
