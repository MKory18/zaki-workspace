import { Prisma, type TaskPriority } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import { db } from "@/server/db";
import { ForbiddenError, type OrgAccessContext } from "@/server/auth";
import { notifyAssignment } from "@/server/notify";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertFeatureOn } from "@/server/services/features";
import { createTask, DEFAULT_BOARD_COLUMNS } from "@/server/services/tasks";

/**
 * «مهمة فورية» (the owner's ask, 2026-10-27: «+ بالمهام ومهمة فورية لشخص محدد مع أولوية»): a task typed in one go —
 * a title, the person, the priority, a day — with no project to pick. It lands in the space's own «مهام فورية»
 * project (made the first time, then found again by its `systemKey`, whatever it was renamed to), in the «to do»
 * column, through `createTask` and so through every rule of a task (the tasks row's «يضيف ويعدّل» box, an active
 * assignee). The person must be in the space, or they would hold a task they cannot open. They are told at once.
 *
 * Behind the «instantWork» switch: off, the route answers «not found» and the tasks already made stay as they are.
 */

export const INSTANT_PROJECT_KEY = "instant";

/** The space's «مهام فورية» board and its «to do» column, made on first use (two at once: one wins, both use it). */
async function instantBoard(workspaceId: string): Promise<{ projectId: string; boardId: string; columnId: string }> {
  const find = () =>
    db.project.findUnique({
      where: { workspaceId_systemKey: { workspaceId, systemKey: INSTANT_PROJECT_KEY } },
      select: { id: true, boards: { where: { archived: false }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true, columns: { orderBy: { position: "asc" }, select: { id: true, done: true } } } } },
    });
  let project = await find();
  if (!project) {
    try {
      await db.project.create({
        data: {
          workspaceId,
          systemKey: INSTANT_PROJECT_KEY,
          name: AR["instant.project"] ?? "مهام فورية",
          status: "ACTIVE",
          boards: {
            create: { name: AR["instant.board"] ?? "فوري", columns: { create: DEFAULT_BOARD_COLUMNS.map((c, i) => ({ ...c, position: i })) } },
          },
        },
      });
    } catch (err) {
      // somebody else made it a moment ago
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
    project = await find();
  }
  if (!project) throw new ForbiddenError("instant.unavailable");
  let board = project.boards[0];
  if (!board || board.columns.length === 0) {
    // its board was archived or emptied: a fresh one
    const made = await db.board.create({
      data: { projectId: project.id, name: AR["instant.board"] ?? "فوري", columns: { create: DEFAULT_BOARD_COLUMNS.map((c, i) => ({ ...c, position: i })) } },
      select: { id: true, columns: { orderBy: { position: "asc" }, select: { id: true, done: true } } },
    });
    board = made;
  }
  // the first column that is not the backlog and not done («للتنفيذ»), else the first
  const open = board.columns.filter((c) => !c.done);
  const column = open[1] ?? open[0] ?? board.columns[0]!;
  return { projectId: project.id, boardId: board.id, columnId: column.id };
}

export interface InstantTaskInput {
  title: string;
  assigneeId: string;
  priority: TaskPriority;
  dueDate: Date | null;
  description?: string | null;
}

/** `ctx`: the caller checked for this space (`requireWorkspace(spaceId, ["ADMIN", "MEMBER"])`). */
export async function createInstantTask(ctx: OrgAccessContext, workspaceId: string, input: InstantTaskInput): Promise<{ id: string; number: number; requested: boolean }> {
  await assertFeatureOn(ctx.orgId, "instantWork");
  assertNotGuest(ctx);
  const [inSpace, owner] = await Promise.all([
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: input.assigneeId } }, select: { id: true } }),
    db.organizationMember.findFirst({ where: { organizationId: ctx.orgId, userId: input.assigneeId, role: "OWNER", status: "ACTIVE" }, select: { id: true } }),
  ]);
  if (!inSpace && !owner) throw new ForbiddenError("instant.not_in_space");
  const where = await instantBoard(workspaceId);
  const task = await createTask(ctx, {
    workspaceId,
    ...where,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority,
    assigneeId: input.assigneeId,
    dueDate: input.dueDate,
  });
  // by RANK (task-assign.ts): somebody of a higher rank was asked, not assigned: they were told by the request instead
  if (task.assigneeId && task.assigneeId !== ctx.userId) {
    const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { keyPrefix: true } });
    await notifyAssignment({
      assigneeId: input.assigneeId,
      taskNumber: task.number,
      orgPrefix: org?.keyPrefix ?? "ZK",
      taskId: task.id,
      title: task.title,
      workspaceId,
    });
  }
  return { id: task.id, number: task.number, requested: task.assignRequest !== null };
}
