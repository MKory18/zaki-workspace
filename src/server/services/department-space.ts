import type { WorkspaceRole } from "@prisma/client";
import { db } from "@/server/db";
import { ensureStarterTopics } from "@/server/chat/space-topics";

/**
 * EVERY DEPARTMENT HAS ITS SPACE (the owner's decision, 2026-10-25: each space is like a separate site). The data move
 * gave the departments of that day a space (`ws_dept_<departmentId>`, prisma/migrations/20261024091000_chat_data_move);
 * this keeps it so: a new department gets one, its people are the department's people (its lead the space's ADMIN),
 * and a renamed department renames it. The OWNER is in every space without a row; a guest is never put in one by a
 * department.
 */

export const deptSpaceIdOf = (departmentId: string): string => `ws_dept_${departmentId}`;

/** The department's space, made (with its starter topics) when it has none. */
export async function ensureDepartmentSpace(
  orgId: string,
  dept: { id: string; name: string; emoji: string | null },
): Promise<string> {
  const existing = await db.workspace.findFirst({ where: { departmentId: dept.id }, select: { id: true } });
  if (existing) return existing.id;
  const space = await db.workspace.upsert({
    where: { id: deptSpaceIdOf(dept.id) },
    create: {
      id: deptSpaceIdOf(dept.id),
      organizationId: orgId,
      name: dept.name,
      slug: `dept-${dept.id}`,
      kind: "DEPARTMENT",
      emoji: dept.emoji,
      departmentId: dept.id,
    },
    update: {},
    select: { id: true },
  });
  await ensureStarterTopics(orgId, space.id);
  return space.id;
}

/**
 * Puts the department's people in its space and takes the ones who left out (with their «مقاطع» there). Only ACTIVE
 * members of the company who are not the OWNER (in every space already) and not a guest; the lead is the space's ADMIN.
 */
export async function syncDepartmentSpace(
  orgId: string,
  departmentId: string,
  change: { add?: readonly string[]; remove?: readonly string[] },
): Promise<void> {
  const dept = await db.department.findFirst({
    where: { id: departmentId, orgId },
    select: { id: true, name: true, emoji: true, leadId: true },
  });
  if (!dept) return;
  const spaceId = await ensureDepartmentSpace(orgId, dept);
  const add = [...new Set(change.add ?? [])];
  const eligible = add.length
    ? await db.organizationMember.findMany({
        where: { organizationId: orgId, userId: { in: add }, status: "ACTIVE", role: { notIn: ["OWNER", "GUEST"] } },
        select: { userId: true },
      })
    : [];
  const remove = (change.remove ?? []).filter((id) => id !== dept.leadId);
  await db.$transaction(async (tx) => {
    for (const { userId } of eligible) {
      const role: WorkspaceRole = userId === dept.leadId ? "ADMIN" : "MEMBER";
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: spaceId, userId } },
        create: { workspaceId: spaceId, userId, role },
        update: {},
      });
    }
    if (remove.length) {
      await tx.teamMember.deleteMany({ where: { userId: { in: remove }, team: { workspaceId: spaceId } } });
      await tx.workspaceMember.deleteMany({ where: { workspaceId: spaceId, userId: { in: remove } } });
    }
  });
}

/** A renamed department (or a new mark, a new lead) carries its space with it. */
export async function alignDepartmentSpace(orgId: string, departmentId: string): Promise<void> {
  const dept = await db.department.findFirst({
    where: { id: departmentId, orgId },
    select: { id: true, name: true, emoji: true, leadId: true },
  });
  if (!dept) return;
  const spaceId = await ensureDepartmentSpace(orgId, dept);
  await db.workspace.update({ where: { id: spaceId }, data: { name: dept.name, emoji: dept.emoji } });
  if (dept.leadId) await syncDepartmentSpace(orgId, dept.id, { add: [dept.leadId] });
  if (dept.leadId) {
    await db.workspaceMember.updateMany({ where: { workspaceId: spaceId, userId: dept.leadId }, data: { role: "ADMIN" } });
  }
}
