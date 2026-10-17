import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace, audit } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson, priorities, taskTypes } from "@/server/validation";
import { createTask, listTasks } from "@/server/services/tasks";
import { dispatchEvent } from "@/server/services/n8n";

const createSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  columnId: z.string().min(1).optional(),
  title: z.string().trim().min(1, "title.required").max(280),
  description: z.string().max(10_000).optional().nullable(),
  priority: z.enum(priorities).optional(),
  type: z.enum(taskTypes).optional(),
  assigneeId: z.string().min(1).optional().nullable(),
  dueDate: z.string().datetime({ offset: true }).or(z.string().date()).optional().nullable(),
  labels: z.array(z.string().min(1)).max(10).optional(),
});

export interface ListFilters {
  projectId?: string;
  boardId?: string;
  assigneeId?: string;
  overdue?: boolean;
  limit: number;
  cursor?: string;
}

const listSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().optional(),
  boardId: z.string().optional(),
  assigneeId: z.string().optional(),
  overdue: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export async function GET(req: Request) {
  return withApi(async () => {
    const url = new URL(req.url);
    const filters = listSchema.parse(Object.fromEntries(url.searchParams));
    const ctx = await requireWorkspace(filters.workspaceId);
    if (filters.overdue) requireValidOverdue();
    const tasks = await listTasks(ctx, {
      projectId: filters.projectId,
      boardId: filters.boardId,
      assigneeId: filters.assigneeId,
      overdue: filters.overdue === "true",
      limit: filters.limit,
      cursor: filters.cursor,
    });
    return NextResponse.json({ tasks, hasMore: tasks.length === filters.limit });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const ctx = await requireWorkspace(input.workspaceId, ["ADMIN", "MEMBER"]);
    const task = await createTask(ctx, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      boardId: input.boardId,
      columnId: input.columnId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      type: input.type,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      labelIds: reqLabels(input),
    });
    await audit("task.created", {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      target: task.id,
    });
    await dispatchEvent(ctx.orgId, "task.created", { taskId: task.id, number: task.number, title: task.title });
    return NextResponse.json({ task }, { status: 201 });
  });
}

/**
 * Labels are passed through untyped in createSchema so that both
 * `labels` (ids) and `labelIds` keep a single canonical shape for the service.
 */
function reqLabels(input: z.infer<typeof createSchema>): string[] {
  return Object.hasOwn(input, "labels") ? (input.labels ?? []) : [];
}

function requireValidOverdue(): void {
  // overdue filtering is validated inside listTasks; keep hook for policy
}
