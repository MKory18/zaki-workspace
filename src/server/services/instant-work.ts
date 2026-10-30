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
  /** «لمين» — one or more people of the space; the first is the task's own assignee, the rest ride beside them. */
  assigneeIds?: string[];
  /** The one person (the form before «لمين» took several): the same as `assigneeIds: [assigneeId]`. */
  assigneeId?: string;
  priority: TaskPriority;
  dueDate: Date | null;
  description?: string | null;
}

/** `ctx`: the caller checked for this space (`requireWorkspace(spaceId, ["ADMIN", "MEMBER"])`). */
export async function createInstantTask(ctx: OrgAccessContext, workspaceId: string, input: InstantTaskInput): Promise<{ id: string; number: number; requested: boolean }> {
  await assertFeatureOn(ctx.orgId, "instantWork");
  assertNotGuest(ctx);
  const people = [...new Set((input.assigneeIds ?? (input.assigneeId ? [input.assigneeId] : [])).filter(Boolean))];
  if (people.length === 0) throw new ForbiddenError("instant.pick_person");
  // every person named must be in this space (or be the company's owner), or they would hold a task they cannot open
  const allowed = await Promise.all(
    people.map(async (userId) => {
      const [inSpace, owner] = await Promise.all([
        db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { id: true } }),
        db.organizationMember.findFirst({ where: { organizationId: ctx.orgId, userId, role: "OWNER", status: "ACTIVE" }, select: { id: true } }),
      ]);
      return Boolean(inSpace || owner);
    }),
  );
  if (allowed.some((ok) => !ok)) throw new ForbiddenError("instant.not_in_space");
  const where = await instantBoard(workspaceId);
  const task = await createTask(ctx, {
    workspaceId,
    ...where,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority,
    assigneeId: people[0]!,
    coAssigneeIds: people.slice(1),
    dueDate: input.dueDate,
  });
  // by RANK (task-assign.ts): somebody of a HIGHER rank was asked, not assigned: they were told by the request instead.
  // Only the people the task really went to (its assignee and the people beside them) are told «أُسندت إليك».
  const held = [
    ...(task.assigneeId && task.assigneeId !== ctx.userId ? [task.assigneeId] : []),
    ...task.coAssignees.map((r) => r.userId).filter((id) => id !== ctx.userId),
  ];
  if (held.length) {
    const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { keyPrefix: true } });
    await Promise.all(
      held.map((assigneeId) =>
        notifyAssignment({
          assigneeId,
          taskNumber: task.number,
          orgPrefix: org?.keyPrefix ?? "ZK",
          taskId: task.id,
          title: task.title,
          workspaceId,
        }),
      ),
    );
  }
  return { id: task.id, number: task.number, requested: task.assignRequest !== null || task.coRequests.length > 0 };
}
