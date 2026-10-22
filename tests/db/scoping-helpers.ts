import { db, makeProject, makeTask, makeTeam, makeWorkspace, uid } from "./helpers";

/**
 * Fixtures for the "a user only sees work in workspaces they can access" batch.
 * (Kept apart from helpers.ts on purpose: that file belongs to the harness.)
 */

/** Today at 12:00 local time: always inside `dayWindow()`'s [00:00, 23:59:59.999]. */
export function todayNoon(): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

/** A moment `n` whole days from now (negative = in the past). */
export function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 3600 * 1000);
}

export interface SeedWorkInput {
  orgId: string;
  workspaceId: string;
  /** Random token shared by the project name and the task title so a search finds exactly this work. */
  token: string;
  label: string;
  creatorId: string;
  assigneeId?: string | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
}

/** One project (with its board) in the workspace plus one task inside it. */
export async function seedWork(input: SeedWorkInput) {
  const made = await makeProject(input.workspaceId, `${input.token} project ${input.label}`);
  const task = await makeTask({
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    projectId: made.project.id,
    boardId: made.board.id,
    columnId: input.completedAt ? made.done.id : made.todo.id,
    creatorId: input.creatorId,
    assigneeId: input.assigneeId ?? null,
    title: `${input.token} task ${input.label}`,
    dueDate: input.dueDate ?? null,
    completedAt: input.completedAt ?? null,
  });
  return { ...made, task };
}

/** Another task in a project that already exists. */
export async function addTask(
  base: { project: { id: string }; board: { id: string }; todo: { id: string }; done: { id: string } },
  input: Omit<SeedWorkInput, "workspaceId" | "label"> & { workspaceId: string; title: string },
) {
  return makeTask({
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    projectId: base.project.id,
    boardId: base.board.id,
    columnId: input.completedAt ? base.done.id : base.todo.id,
    creatorId: input.creatorId,
    assigneeId: input.assigneeId ?? null,
    title: input.title,
    dueDate: input.dueDate ?? null,
    completedAt: input.completedAt ?? null,
  });
}

/**
 * One org (owner, admin, member, guest) with two workspaces:
 *  - `wsIn`  : the plain MEMBER belongs to it
 *  - `wsOut` : the plain MEMBER does NOT belong to it (nobody but org owner/admin can open it)
 * Each workspace holds a project and a task named after `token`.
 */
export async function makeScopedOrg() {
  const team = await makeTeam();
  const token = `zq${uid()}`;
  const wsIn = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `In ${token}`);
  const wsOut = await makeWorkspace(team.org.id, [], `Out ${token}`);
  const inside = await seedWork({
    orgId: team.org.id,
    workspaceId: wsIn.id,
    token,
    label: "in",
    creatorId: team.owner.id,
  });
  const outside = await seedWork({
    orgId: team.org.id,
    workspaceId: wsOut.id,
    token,
    label: "out",
    creatorId: team.owner.id,
  });
  return { ...team, token, wsIn, wsOut, inside, outside };
}

export type ScopedOrg = Awaited<ReturnType<typeof makeScopedOrg>>;

/** Adds an existing user to an org with the given role. */
export async function joinOrg(userId: string, orgId: string, role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST") {
  return db.organizationMember.create({ data: { organizationId: orgId, userId, role } });
}

/** Adds an existing user to a workspace. */
export async function joinWorkspace(userId: string, workspaceId: string, role: "ADMIN" | "MEMBER" | "GUEST" = "MEMBER") {
  return db.workspaceMember.create({ data: { workspaceId, userId, role } });
}
