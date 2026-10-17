import * as crypto from "node:crypto";
import { db } from "@/server/db";

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

/** People assignable within a workspace (members + org admins/owners). */
export async function listWorkspaceMembers(workspaceId: string) {
  const [wsMembers, org] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true } },
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
  const byId = new Map<string, { id: string; name: string; email: string; role: string }>();
  for (const m of wsMembers) {
    byId.set(m.user.id, { ...m.user, role: m.role });
  }
  for (const m of org.organization.members) {
    if (!byId.has(m.user.id)) byId.set(m.user.id, { ...m.user, role: `org:${m.role}` });
  }
  return [...byId.values()];
}
