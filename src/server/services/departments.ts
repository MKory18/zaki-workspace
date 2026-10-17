import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";

/** Department mutations are office-level decisions: OWNER/ADMIN only. */
export function canManageDepartments(orgRole: string): boolean {
  return orgRole === "OWNER" || orgRole === "ADMIN";
}

export const DEPARTMENT_COLORS = ["sky", "emerald", "amber", "fuchsia", "indigo", "rose"] as const;

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2, "dept.name_short").max(40),
  emoji: z.string().trim().max(16).optional().nullable(),
  color: z.enum(DEPARTMENT_COLORS).optional().nullable(),
  leadId: z.string().min(1).optional().nullable(),
  memberIds: z.array(z.string()).max(200).optional(),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const membersSchema = z
  .object({
    addUserIds: z.array(z.string()).max(200).optional(),
    removeUserIds: z.array(z.string()).max(200).optional(),
  })
  .refine((v) => Boolean(v.addUserIds?.length || v.removeUserIds?.length), { message: "dept.no_change" });

async function assertOrgUsers(orgId: string, userIds: string[]) {
  if (userIds.length === 0) return [];
  const rows = await db.organizationMember.findMany({
    where: { organizationId: orgId, userId: { in: userIds } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function createDepartment(ctx: OrgAccessContext, input: z.infer<typeof createDepartmentSchema>) {
  if (!canManageDepartments(ctx.orgRole)) throw new ForbiddenError("dept.admin_only");
  if (input.leadId) {
    const ok = await assertOrgUsers(ctx.orgId, [input.leadId]);
    if (ok.length === 0) throw new NotFoundError("dept.lead_not_member");
  }
  const validMembers = await assertOrgUsers(ctx.orgId, input.memberIds ?? []);

  const dept = await db.department.create({
    data: {
      orgId: ctx.orgId,
      name: input.name,
      emoji: input.emoji || null,
      color: input.color || null,
      leadId: input.leadId || null,
      memberships: { create: validMembers.map((userId) => ({ userId })) },
    },
    select: { id: true, name: true },
  });
  return dept;
}

export async function listDepartments(orgId: string) {
  const rows = await db.department.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
    include: {
      memberships: { select: { user: { select: { id: true, name: true, jobTitle: true } }, role: true } },
      projects: { select: { id: true, tasks: { select: { completedAt: true, dueDate: true } } } },
      tickets: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true } },
    },
  });
  return rows.map((d) => {
    const all = d.projects.flatMap((p) => p.tasks);
    const open = all.filter((t) => !t.completedAt).length;
    const overdue = all.filter((t) => !t.completedAt && t.dueDate && t.dueDate < new Date()).length;
    return {
      id: d.id,
      name: d.name,
      emoji: d.emoji,
      color: d.color,
      leadId: d.leadId,
      members: d.memberships.map((m) => ({ id: m.user.id, name: m.user.name, jobTitle: m.user.jobTitle, role: m.role })),
      projectsCount: d.projects.length,
      openTasks: open,
      overdueTasks: overdue,
      openTickets: d.tickets.length,
    };
  });
}

export async function getDepartment(orgId: string, id: string) {
  const d = await db.department.findFirst({ where: { id, orgId } });
  if (!d) throw new NotFoundError("dept.not_found");
  const members = await db.departmentMember.findMany({
    where: { departmentId: d.id },
    include: { user: { select: { id: true, name: true, jobTitle: true } } },
  });
  const projects = await db.project.findMany({
    where: { departmentId: d.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      priority: true,
      tasks: { select: { completedAt: true, dueDate: true } },
      workspace: { select: { name: true } },
    },
  });
  return {
    id: d.id,
    name: d.name,
    emoji: d.emoji,
    color: d.color,
    leadId: d.leadId,
    members: members.map((m) => ({ id: m.user.id, name: m.user.name, jobTitle: m.user.jobTitle, role: m.role })),
    projects: projects.map((p) => {
      const open = p.tasks.filter((t) => !t.completedAt).length;
      const done = p.tasks.filter((t) => t.completedAt).length;
      return {
        id: p.id,
        name: p.name,
        status: p.status as string,
        priority: p.priority as string,
        workspace: p.workspace.name,
        openTasks: open,
        doneTasks: done,
      };
    }),
  };
}

export async function updateDepartment(ctx: OrgAccessContext, id: string, input: z.infer<typeof updateDepartmentSchema>) {
  if (!canManageDepartments(ctx.orgRole)) throw new ForbiddenError("dept.admin_only");
  const d = await db.department.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!d) throw new NotFoundError("dept.not_found");
  if (input.leadId) {
    const ok = await assertOrgUsers(ctx.orgId, [input.leadId]);
    if (ok.length === 0) throw new NotFoundError("dept.lead_not_member");
  }
  await db.department.update({
    where: { id: d.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.emoji !== undefined ? { emoji: input.emoji || null } : {}),
      ...(input.color !== undefined ? { color: input.color || null } : {}),
      ...(input.leadId !== undefined ? { leadId: input.leadId || null } : {}),
    },
  });
}

export async function deleteDepartment(ctx: OrgAccessContext, id: string): Promise<void> {
  if (!canManageDepartments(ctx.orgRole)) throw new ForbiddenError("dept.admin_only");
  const d = await db.department.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
  if (!d) throw new NotFoundError("dept.not_found");
  // members cascade; projects survive with departmentId = null (SetNull)
  await db.department.delete({ where: { id: d.id } });
}

export async function setMembers(ctx: OrgAccessContext, id: string, input: z.infer<typeof membersSchema>) {
  if (!canManageDepartments(ctx.orgRole)) throw new ForbiddenError("dept.admin_only");
  const d = await db.department.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
  if (!d) throw new NotFoundError("dept.not_found");
  const add = await assertOrgUsers(ctx.orgId, input.addUserIds ?? []);
  const remove = input.removeUserIds ?? [];
  await db.$transaction(async (tx) => {
    for (const userId of add) {
      await tx.departmentMember.upsert({
        where: { departmentId_userId: { departmentId: id, userId } },
        create: { departmentId: id, userId },
        update: {},
      });
    }
    if (remove.length) {
      await tx.departmentMember.deleteMany({
        where: { departmentId: id, userId: { in: remove } },
      });
    }
  });
}
