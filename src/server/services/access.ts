import { db } from "@/server/db";

/**
 * Workspace-level isolation — the company's master switch.
 *
 * A workspace (space) is visible to the people who are IN it and to the organization OWNER, who
 * sees every workspace of the company. Nobody else inherits anything: an ADMIN sees the spaces
 * they were added to, like everybody else. Only ACTIVE organization members count (a suspended
 * or offboarded person has no access, whatever rows they left behind).
 */

/** Organizations where the user is an ACTIVE OWNER (they see every workspace there). */
export async function canInheritWorkspaces(userId: string): Promise<string[]> {
  const memberships = await db.organizationMember.findMany({
    where: { userId, role: "OWNER", status: "ACTIVE" },
    select: { organizationId: true },
  });
  return memberships.map((m) => m.organizationId);
}

/** Workspace ids the user may open. Returned ids are already org-bound. */
export async function accessibleWorkspaceIds(userId: string): Promise<string[]> {
  const memberships = await db.organizationMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { role: true, organizationId: true },
  });
  const orgIds = memberships.map((m) => m.organizationId);
  if (orgIds.length === 0) return [];

  const ownedOrgIds = memberships.filter((m) => m.role === "OWNER").map((m) => m.organizationId);

  const [everything, assigned] = await Promise.all([
    ownedOrgIds.length
      ? db.workspace.findMany({ where: { organizationId: { in: ownedOrgIds } }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
    db.workspaceMember.findMany({
      where: { userId, workspace: { organizationId: { in: orgIds } } },
      select: { workspaceId: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const w of everything) ids.add(w.id);
  for (const m of assigned) ids.add(m.workspaceId);
  return [...ids];
}

/** Can the caller manage workspace membership (add/remove/role)? */
export async function canManageWorkspaceMembers(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { organizationId: true },
  });
  if (!ws) return false;
  const [wsMember, om] = await Promise.all([
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    }),
    db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: ws.organizationId, userId } },
      select: { role: true, status: true },
    }),
  ]);
  if (!om || om.status !== "ACTIVE") return false;
  if (om.role === "OWNER") return true;
  // anyone else must be IN the workspace; a workspace admin manages it, and so does an org ADMIN
  // (who outranks a lower row of their own)
  return !!wsMember && (wsMember.role === "ADMIN" || om.role === "ADMIN");
}
