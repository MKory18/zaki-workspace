import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { requireTaskAccess, audit, ForbiddenError, NotFoundError } from "@/server/auth";
import { userSeesProject } from "@/server/services/team-scope";
import { withApi } from "@/server/api";
import { parseJson, priorities, taskTypes } from "@/server/validation";
import { updateTask, deleteTask } from "@/server/services/tasks";
import { assertActiveAssignee } from "@/server/services/active-people";
import { notifyAssignment } from "@/server/notify";


export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    // its space, then its project's team: outside the team it is «not found»
    await requireTaskAccess(params.id);
    const task = await db.task.findFirst({
      where: { id: params.id },
      include: {
        labels: { select: { label: true } },
        assignee: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
        milestone: { select: { id: true, name: true } },
        comments: { orderBy: { createdAt: "desc" }, include: { author: { select: { id: true, name: true } } } },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 30,
          include: { actor: { select: { id: true, name: true } } },
        },
        dependencies: {
          select: { id: true, kind: true, dependsOn: { select: { id: true, title: true, number: true } } },
        },
        _count: { select: { comments: true } },
      },
    });
    if (!task) throw new NotFoundError("task.not_found");
    return NextResponse.json({ task });
  });
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(280).optional(),
  description: z.string().max(10_000).nullable().optional(),
  priority: z.enum(priorities).optional(),
  type: z.enum(taskTypes).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
  archived: z.boolean().optional(),
  labelIds: z.array(z.string().min(1)).max(15).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    const ctx = await requireTaskAccess(params.id, ["ADMIN", "MEMBER"]);
    const prevAssignee = await db.task.findUnique({
      where: { id: params.id },
      select: { assigneeId: true, number: true, orgId: true },
    });
    // Handing the task to somebody NEW: they must be an ACTIVE member of the org (never a stranger,
    // never someone who was suspended or has left). Re-sending the current assignee, who may have
    // been suspended since, changes nothing: work somebody holds stays editable until it is moved.
    if (input.assigneeId && input.assigneeId !== prevAssignee?.assigneeId) {
      await assertActiveAssignee(ctx.orgId, input.assigneeId);
      // a team's task goes to somebody who sees that team's work (its members and the space's managers)
      if (ctx.task.teamId && !(await userSeesProject(input.assigneeId, ctx.task))) throw new ForbiddenError("assignee.not_in_team");
    }
    const task = await updateTask(ctx, params.id, {
      title: input.title,
      description: input.description ?? undefined,
      priority: input.priority,
      type: input.type,
      assigneeId: input.assigneeId === null ? null : input.assigneeId,
      dueDate: input.dueDate === null ? null : input.dueDate ? new Date(input.dueDate) : undefined,
      startDate: input.startDate === null ? null : input.startDate ? new Date(input.startDate) : undefined,
      archived: input.archived,
      labelIds: input.labelIds,
    });
    await audit("task.updated", { actorId: ctx.userId, orgId: ctx.orgId, target: params.id });
    if (input.assigneeId && input.assigneeId !== prevAssignee?.assigneeId) {
      await notifyAssignment({
        assigneeId: input.assigneeId,
        taskNumber: prevAssignee?.number ?? 0,
        orgPrefix: await orgPrefix(prevAssignee?.orgId ?? task.orgId),
        taskId: task.id,
        title: task.title,
        workspaceId: ctx.task.workspaceId,
      });
    }
    return NextResponse.json({ task });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireTaskAccess(params.id, ["ADMIN"]);
    await deleteTask(ctx, params.id);
    await audit("task.deleted", { actorId: ctx.userId, orgId: ctx.orgId, target: params.id });
    return NextResponse.json({ ok: true });
  });
}

async function orgPrefix(orgId: string): Promise<string> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { keyPrefix: true },
  });
  return org?.keyPrefix ?? "ZW";
}
