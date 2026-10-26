import { Prisma, type Task } from "@prisma/client";
import { assertMemberCan } from "@/server/policy/actor";
import { userSeesProject } from "./team-scope";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { AR } from "@/lib/i18n/dict";

export interface ActorContext {
  userId: string;
  orgId: string;
}

export interface CreateTaskInput {
  workspaceId: string;
  projectId: string;
  boardId: string;
  columnId?: string;
  title: string;
  description?: string | null;
  priority?: Task["priority"];
  type?: Task["type"];
  assigneeId?: string | null;
  dueDate?: Date | null;
  startDate?: Date | null;
  labelIds?: string[];
}

export interface MoveTaskInput {
  columnId: string;
  /** 0-based index within the destination column; default = append to end. */
  index?: number;
}

export const TASK_INCLUDE = {
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
  assignee: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

export type TaskDTO = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export type Tx = Prisma.TransactionClient;

export interface DefaultBoardColumn {
  name: string;
  color: string;
  done: boolean;
}

/**
 * The workflow a new board starts with. The names are Arabic (no English reaches a screen): the same
 * words `columnLabel` shows for the English defaults boards were given before, so an old board and a
 * new one read alike. Boards that already exist keep their names; only what is shown is translated.
 * (A column's colour is user data, stored as a hex value.)
 */
export const DEFAULT_BOARD_COLUMNS: readonly DefaultBoardColumn[] = [
  { name: AR["column.backlog"]!, color: "#6b7280", done: false },
  { name: AR["column.todo"]!, color: "#3b82f6", done: false },
  { name: AR["column.in_progress"]!, color: "#f59e0b", done: false },
  { name: AR["column.review"]!, color: "#a855f7", done: false },
  { name: AR["column.done"]!, color: "#10b981", done: true },
];

/**
 * Per-org sequential number (task key = `${prefix}-${number}`).
 * Counter is upserted inside the caller's transaction; unique(orgId, number)
 * protects against two concurrent creates claiming the same number.
 */
export async function nextTaskNumber(orgId: string, tx: Tx): Promise<number> {
  const counter = await tx.taskCounter.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return counter.lastNumber;
}

interface PositionRow {
  position: string;
}

/**
 * Fractional-rank positioning: inserts touch at most 2 previous rows and write
 * one row, so bulk moves never renumber a column. Concurrent identical inserts
 * resolve by the deterministic `(position, id)` tiebreaker.
 */
async function positionAt(
  columnId: string,
  index: number | undefined,
  tx: Tx,
): Promise<Prisma.Decimal | number> {
  const rows = await tx.$queryRaw<PositionRow[]>`
    SELECT "position"::text FROM "Task"
    WHERE "columnId" = ${columnId} AND archived = false
    ORDER BY "position" ASC, id ASC`;
  const n = rows.length;
  if (n === 0) return 1000;
  const idx = index === undefined ? n : Math.max(0, Math.min(n, index));
  if (idx === 0) return Number(rows[0]!.position) / 2;
  if (idx === n) return Number(rows[n - 1]!.position) + 1000;
  return (Number(rows[idx - 1]!.position) + Number(rows[idx]!.position)) / 2;
}

interface ScopedTask {
  id: string;
  projectId: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Task["priority"];
  type: Task["type"];
  assigneeId: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  archived: boolean;
}

async function assertTaskScope(taskId: string, orgId: string, tx: Tx): Promise<ScopedTask> {
  const task = await tx.task.findFirst({
    where: { id: taskId, orgId },
    select: {
      id: true,
      projectId: true,
      boardId: true,
      columnId: true,
      title: true,
      description: true,
      priority: true,
      type: true,
      assigneeId: true,
      dueDate: true,
      completedAt: true,
      archived: true,
    },
  });
  if (!task) throw new NotFoundError("task.not_found");
  return task;
}

export async function createTask(actor: ActorContext, input: CreateTaskInput): Promise<TaskDTO> {
  // the tasks row of the person's grid (every way a task is born comes here: the board, a message, an idea)
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  return db.$transaction(async (tx) => {
    // integrity: ids must chain to the actor's organization
    const chain = await tx.project.findFirst({
      where: {
        id: input.projectId,
        workspace: { id: input.workspaceId, organizationId: actor.orgId },
      },
      select: { id: true, workspaceId: true, teamId: true },
    });
    if (!chain) throw new NotFoundError("project.not_found");
    // a project of a team takes tasks only from that team and the space's managers (the route, an idea
    // converted to a task, a quick add: every caller comes through here)
    if (chain.teamId && !(await userSeesProject(actor.userId, chain))) throw new NotFoundError("project.not_found");

    const board = await tx.board.findFirst({
      where: { id: input.boardId, projectId: input.projectId },
      include: { columns: { orderBy: { position: "asc" } } },
    });
    if (!board) throw new NotFoundError("board.not_found");
    const column = board.columns.find((c) => c.id === input.columnId) ?? board.columns[0];
    if (!column) throw new NotFoundError("board.no_columns");

    if (input.labelIds?.length) {
      const uniqueIds = [...new Set(input.labelIds)];
      const count = await tx.label.count({
        where: { orgId: actor.orgId, id: { in: uniqueIds } },
      });
      if (count !== uniqueIds.length) throw new ForbiddenError("label.invalid");
    }

    // P1: never allow assigning a task to a user outside the actor's org, nor to one who is no
    // longer active in it (suspended or offboarded keep their row, but they do not count)
    if (input.assigneeId) {
      const member = await tx.organizationMember.findFirst({
        where: { organizationId: actor.orgId, userId: input.assigneeId },
        select: { status: true },
      });
      if (!member) throw new ForbiddenError("assignee.not_member");
      if (member.status !== "ACTIVE") throw new ForbiddenError("assignee.not_active");
      // a team's task goes to somebody who sees that team's work (its members and the space's managers)
      if (chain.teamId && !(await userSeesProject(input.assigneeId, chain))) throw new ForbiddenError("assignee.not_in_team");
    }

    const number = await nextTaskNumber(actor.orgId, tx);
    const task = await tx.task.create({
      data: {
        number,
        orgId: actor.orgId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        boardId: input.boardId,
        columnId: column.id,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? "NORMAL",
        type: input.type ?? "TASK",
        assigneeId: input.assigneeId ?? null,
        dueDate: input.dueDate ?? null,
        startDate: input.startDate ?? null,
        creatorId: actor.userId,
        position: await positionAt(column.id, undefined, tx),
        labels: input.labelIds?.length
          ? { create: [...new Set(input.labelIds)].map((labelId) => ({ labelId })) }
          : undefined,
      },
      include: TASK_INCLUDE,
    });
    await tx.taskActivity.create({
      data: {
        taskId: task.id,
        actorId: actor.userId,
        event: "task.created",
        meta: { columnId: column.id },
      },
    });
    return task;
  });
}

export async function moveTask(
  actor: ActorContext,
  taskId: string,
  input: MoveTaskInput,
): Promise<TaskDTO> {
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  return db.$transaction(async (tx) => {
    const task = await assertTaskScope(taskId, actor.orgId, tx);
    const column = await tx.boardColumn.findFirst({
      where: { id: input.columnId, boardId: task.boardId },
    });
    if (!column) throw new ForbiddenError("column.invalid");

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        columnId: column.id,
        position: await positionAt(column.id, input.index, tx),
        completedAt: column.done ? new Date() : null,
      },
      include: TASK_INCLUDE,
    });
    if (task.columnId !== column.id) {
      await tx.taskActivity.create({
        data: {
          taskId,
          actorId: actor.userId,
          event: "task.moved",
          meta: { from: task.columnId, to: column.id },
        },
      });
    }
    return updated;
  });
}

export interface TaskUpdateData {
  title?: string;
  description?: string | null;
  priority?: Task["priority"];
  type?: Task["type"];
  assigneeId?: string | null;
  dueDate?: Date | null;
  startDate?: Date | null;
  milestoneId?: string | null;
  archived?: boolean;
  /** Replaces the full label set when provided. */
  labelIds?: string[];
}

export async function updateTask(
  actor: ActorContext,
  taskId: string,
  data: TaskUpdateData,
): Promise<TaskDTO> {
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  return db.$transaction(async (tx) => {
    const before = await assertTaskScope(taskId, actor.orgId, tx);
    const updateData: Prisma.TaskUpdateInput = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.assigneeId !== undefined) {
      // never assign to a user outside the actor's org, or to one who is not active in it (the same
      // rule as on create); re-sending the current assignee changes nothing, so it is not re-checked:
      // work somebody already holds stays editable around them until it is moved
      if (data.assigneeId !== null && data.assigneeId !== before.assigneeId) {
        const member = await tx.organizationMember.findFirst({
          where: { organizationId: actor.orgId, userId: data.assigneeId },
          select: { status: true },
        });
        if (!member) throw new ForbiddenError("assignee.not_member");
        if (member.status !== "ACTIVE") throw new ForbiddenError("assignee.not_active");
      }
      updateData.assignee =
        data.assigneeId === null
          ? { disconnect: true }
          : { connect: { id: data.assigneeId } };
    }
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate;
    if (data.startDate !== undefined) updateData.startDate = data.startDate;
    if (data.milestoneId !== undefined) {
      if (data.milestoneId === null) {
        updateData.milestone = { disconnect: true };
      } else {
        // P2: milestone must belong to this task's project (and thus the actor's org)
        const milestone = await tx.milestone.findFirst({
          where: { id: data.milestoneId, projectId: before.projectId },
          select: { id: true },
        });
        if (!milestone) throw new ForbiddenError("milestone.invalid");
        updateData.milestone = { connect: { id: data.milestoneId } };
      }
    }
    if (data.archived !== undefined) updateData.archived = data.archived;
    if (data.labelIds) {
      const uniqueIds = [...new Set(data.labelIds)];
      const count = await tx.label.count({
        where: { orgId: actor.orgId, id: { in: uniqueIds } },
      });
      if (count !== uniqueIds.length) throw new ForbiddenError("label.invalid");
      updateData.labels = {
        deleteMany: {},
        create: uniqueIds.map((labelId) => ({ labelId })),
      };
    }
    const updated = await tx.task.update({
      where: { id: taskId },
      data: updateData,
      include: TASK_INCLUDE,
    });
    const changed: string[] = [];
    if (data.title !== undefined && data.title !== before.title) changed.push("title");
    if (data.description !== undefined && data.description !== before.description) changed.push("description");
    if (data.priority !== undefined && data.priority !== before.priority) changed.push("priority");
    if (data.type !== undefined && data.type !== before.type) changed.push("type");
    if (data.assigneeId !== undefined && data.assigneeId !== before.assigneeId) changed.push("assignee");
    if (data.labelIds) changed.push("labels");
    const dueBefore = before.dueDate?.getTime() ?? null;
    const dueAfter = data.dueDate === undefined ? dueBefore : (data.dueDate?.getTime() ?? null);
    if (dueBefore !== dueAfter) changed.push("dueDate");
    if (changed.length) {
      await tx.taskActivity.create({
        data: {
          taskId,
          actorId: actor.userId,
          event: "task.updated",
          meta: { fields: changed },
        },
      });
    }
    return updated;
  });
}

export async function deleteTask(actor: ActorContext, taskId: string): Promise<void> {
  await assertMemberCan(actor, "tasks.delete", "section.delete_denied", { spaceGuestsPass: true });
  await assertTaskScope(taskId, actor.orgId, db);
  await db.task.delete({ where: { id: taskId } });
}

/**
 * Complete/uncomplete via the board's done column (or first open column).
 * Uses the same move path rules; stamps/clears completedAt accordingly.
 */
export async function setTaskCompletion(
  actor: ActorContext,
  taskId: string,
  complete: boolean,
): Promise<TaskDTO> {
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  return db.$transaction(async (tx) => {
    const task = await assertTaskScope(taskId, actor.orgId, tx);
    const target = await tx.boardColumn.findFirst({
      where: { boardId: task.boardId, done: complete },
      orderBy: { position: "asc" },
    });
    if (!target) {
      throw new ForbiddenError(complete ? "board.no_done_column" : "board.no_open_column");
    }
    const alreadyDone = task.completedAt != null;
    if (alreadyDone === complete) return tx.task.findFirstOrThrow({ where: { id: taskId }, include: TASK_INCLUDE });
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        columnId: target.id,
        position: await positionAt(target.id, undefined, tx),
        completedAt: complete ? new Date() : null,
      },
      include: TASK_INCLUDE,
    });
    await tx.taskActivity.create({
      data: {
        taskId,
        actorId: actor.userId,
        event: complete ? "task.completed" : "task.reopened",
        meta: { columnId: target.id },
      },
    });
    return updated;
  });
}

// ---------- reads ----------

export interface ListFilters {
  /** The space the caller passed the guard for: nothing outside it is listed. */
  workspaceId: string;
  /** Which of its projects (the teams the caller sees: `teamFilterInSpace`). */
  project?: Prisma.ProjectWhereInput;
  projectId?: string;
  boardId?: string;
  assigneeId?: string;
  overdue?: boolean;
  limit: number;
  cursor?: string;
}

export async function listTasks(actor: ActorContext, filters: ListFilters): Promise<TaskDTO[]> {
  await assertMemberCan(actor, "tasks.view", "section.view_denied", { spaceGuestsPass: true });
  const where: Prisma.TaskWhereInput = {
    orgId: actor.orgId,
    // before teams this listed the whole company's tasks for anyone in ANY one space: now only that space
    workspaceId: filters.workspaceId,
    ...(filters.project && Object.keys(filters.project).length ? { project: filters.project } : {}),
    archived: false,
    projectId: filters.projectId,
    boardId: filters.boardId,
    assigneeId: filters.assigneeId,
  };
  if (filters.overdue) {
    where.dueDate = { lt: new Date() };
    where.completedAt = null;
  }
  if (filters.cursor) {
    where.id = { lt: filters.cursor };
  }
  return db.task.findMany({
    where,
    orderBy: [{ id: "desc" }],
    take: filters.limit,
    include: TASK_INCLUDE,
  });
}
