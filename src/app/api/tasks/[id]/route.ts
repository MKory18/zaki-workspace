import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { requireWorkspace, audit, NotFoundError, ForbiddenError } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson, priorities, taskTypes } from "@/server/validation";
import { updateTask, deleteTask } from "@/server/services/tasks";
import { notifyAssignment } from "@/server/notify";

/** Resolves a task id to its workspace for membership checks. */
async function taskWorkspace(taskId: string): Promise<string> {
  const task = await db.task.findFirst({
    where: { id: taskId },
    select: { workspaceId: true, orgId: true, title: true },
  });
  if (!task) throw new NotFoundError("task.not_found");
  return task.workspaceId;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const wsId = await taskWorkspace(params.id);
    await requireWorkspace(wsId);
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
    const wsId = await taskWorkspace(params.id);
    const ctx = await requireWorkspace(wsId, ["ADMIN", "MEMBER"]);
    // assignee must belong to the org (never assign to strangers)
    if (input.assigneeId) {
      const member = await db.organizationMember.findFirst({
        where: { organizationId: ctx.orgId, userId: input.assigneeId },
        select: { id: true },
      });
      if (!member) throw new ForbiddenError("assignee.not_member");
    }
    const prevAssignee = await db.task.findUnique({
      where: { id: params.id },
      select: { assigneeId: true, number: true, orgId: true },
    });
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
      });
    }
    return NextResponse.json({ task });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const wsId = await taskWorkspace(params.id);
    const ctx = await requireWorkspace(wsId, ["ADMIN"]);
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
