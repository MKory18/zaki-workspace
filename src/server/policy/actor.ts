import type { OrgRole } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, requireUser } from "@/server/auth";
import { can, effectiveCapabilities, type Capability } from "./capabilities";
import { sectionGridOf } from "./section-grid";

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
    select: {
      organizationId: true,
      role: true,
      capabilities: true,
      revokedCapabilities: true,
      primaryOwner: true,
      organization: { select: { settings: true } },
    },
  });
  if (!member) throw new ForbiddenError("not_org_member");
  return {
    userId: user.id,
    orgId: member.organizationId,
    role: member.role,
    // the section grid counts while its switch in «الميزات» is on
    caps: effectiveCapabilities(member, { sectionGrid: sectionGridOf(member.organization.settings) }),
    isOwner: member.role === "OWNER",
    isPrimaryOwner: member.role === "OWNER" && member.primaryOwner,
    isExternal: member.role === "GUEST",
  };
}

export function actorCan(actor: Pick<Actor, "caps">, capability: Capability): boolean {
  return actor.caps.has(capability);
}

/**
 * The signed-in person's box for a section that also serves the spaces' external partners (projects, tasks): a GUEST
 * passes (the space's own rules decide for them), anyone else needs the box.
 */
export function actorCanWork(actor: Pick<Actor, "caps" | "isExternal">, capability: Capability): boolean {
  return actor.isExternal || actor.caps.has(capability);
}

/** 403 `code` (`insufficient_role` unless told otherwise) unless the actor holds the capability (a guest holds none). */
export function assertCan(actor: Pick<Actor, "caps">, capability: Capability, code = "insufficient_role"): void {
  if (!actorCan(actor, capability)) throw new ForbiddenError(code);
}

/** The capability check for a member row read from the database (not the signed-in actor). */
export { can };

/**
 * The same check inside a service that is handed only `{ orgId, userId }`: reads the person's ACTIVE membership and
 * throws 403 `code` unless it holds the capability. The routes check too; this is the door a new caller can not forget.
 */
export async function assertMemberCan(
  ctx: { orgId: string; userId: string },
  capability: Capability,
  code = "insufficient_role",
  /**
   * `spaceGuestsPass`: an external partner (GUEST) holds no capability, yet works in the spaces shared with them under
   * the space's own rules (projects and tasks): for them those rules decide, not the grid.
   */
  opts: { spaceGuestsPass?: boolean } = {},
): Promise<void> {
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId } },
    select: {
      status: true,
      role: true,
      capabilities: true,
      revokedCapabilities: true,
      primaryOwner: true,
      organization: { select: { settings: true } },
    },
  });
  if (!member || member.status !== "ACTIVE") throw new ForbiddenError("not_org_member");
  if (opts.spaceGuestsPass && member.role === "GUEST") return;
  if (!can(member, capability, { sectionGrid: sectionGridOf(member.organization.settings) })) throw new ForbiddenError(code);
}
