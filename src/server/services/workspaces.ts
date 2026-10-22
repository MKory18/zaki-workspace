import * as crypto from "node:crypto";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth";
import { workspaceRoleOf } from "@/server/workspace-role";

export interface CreateWorkspaceInput {
  organizationId: string;
  name: string;
  description?: string | null;
}

/** Caller must verify org role (OWNER/ADMIN) before invoking. */
export async function createWorkspace(userId: string, input: CreateWorkspaceInput) {
  const base = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  const slug = `${base || "ws"}-${crypto.randomBytes(2).toString("hex")}`;
  return db.workspace.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      slug,
      description: input.description ?? null,
      members: { create: { userId, role: "ADMIN" } },
    },
    select: { id: true, name: true, slug: true },
  });
}

/**
 * People assignable within a workspace (members + org admins/owners).
 *
 * The viewer is the signed-in user unless `viewerId` is given. An org GUEST gets
 * names only (`{ id, name }`, never an email or a role) and only the people who
 * are members of this workspace; everyone else gets the full rows.
 */
export async function listWorkspaceMembers(workspaceId: string, viewerId?: string) {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
  if (!ws) return [];
  const viewer = viewerId ?? (await requireUser()).id;
  const viewerRow = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ws.organizationId, userId: viewer } },
    select: { role: true },
  });
  if (!viewerRow || viewerRow.role === "GUEST") {
    // fail closed: somebody with no org membership is treated like a guest
    const rows = await db.workspaceMember.findMany({
      where: { workspaceId, user: { memberships: { some: { organizationId: ws.organizationId } } } },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({ id: r.user.id, name: r.user.name }));
  }

  const [wsMembers, org] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        role: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            memberships: { where: { organizationId: ws.organizationId }, select: { role: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        organizationId: true,
        organization: {
          select: { members: { where: { role: { in: ["OWNER", "ADMIN"] } }, select: { role: true, user: { select: { id: true, name: true, email: true } } } } },
        },
      },
    }),
  ]);
  if (!org) return [];
  const byId = new Map<string, { id: string; name: string; email: string | null; role: string }>();
  for (const m of wsMembers) {
    // shown as the role they really have: an org GUEST is a GUEST whatever their row says
    byId.set(m.user.id, {
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: workspaceRoleOf(m.user.memberships[0]?.role, m.role),
    });
  }
  for (const m of org.organization.members) {
    if (!byId.has(m.user.id)) byId.set(m.user.id, { ...m.user, role: `org:${m.role}` });
  }
  return [...byId.values()];
}
