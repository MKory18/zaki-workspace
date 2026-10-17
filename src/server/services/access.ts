import { db } from "@/server/db";

/**
 * Workspace-level isolation — the company's master switch.
 * Org OWNER/ADMIN see every workspace in their orgs (inherit).
 * Everyone else only sees workspaces they are explicitly assigned to.
 * GUESTs never inherit; they only get assigned workspaces.
 */
export async function canInheritWorkspaces(userId: string): Promise<string[]> {
  const memberships = await db.organizationMember.findMany({
    where: { userId, role: { in: ["OWNER", "ADMIN"] } },
    select: { organizationId: true },
  });
  return memberships.map((m) => m.organizationId);
}

/** Workspace ids the user may open. Returned ids are already org-bound. */
export async function accessibleWorkspaceIds(userId: string): Promise<string[]> {
  const memberships = await db.organizationMember.findMany({
    where: { userId },
    select: { role: true, organizationId: true },
  });
  const orgIds = memberships.map((m) => m.organizationId);
  if (orgIds.length === 0) return [];

  const inheritIds = memberships
    .filter((m) => m.role === "OWNER" || m.role === "ADMIN")
    .map((m) => m.organizationId);

  const [inherited, assigned] = await Promise.all([
    inheritIds.length
      ? db.workspace.findMany({ where: { organizationId: { in: inheritIds } }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
    db.workspaceMember.findMany({
      where: { userId, workspace: { organizationId: { in: orgIds } } },
      select: { workspaceId: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const w of inherited) ids.add(w.id);
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
      select: { role: true },
    }),
  ]);
  return wsMember?.role === "ADMIN" || om?.role === "OWNER" || om?.role === "ADMIN";
}
