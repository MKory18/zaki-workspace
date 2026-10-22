import { Prisma, type TaskPriority } from "@prisma/client";
import { db } from "@/server/db";
import { TASK_INCLUDE } from "@/server/services/tasks";
import { accessibleWorkspaceIds } from "@/server/services/access";

// ---------- workspace access resolution for RSC pages ----------

import { currentUser } from "@/server/auth";

export interface WorkspaceViewCtx {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  orgId: string;
  /** The user's role in that org (not the workspace role): what decides guest-only limits. */
  orgRole: string;
  /** Effective role (workspace member role wins over org role). */
  role: string;
  editable: boolean;
  /**
   * Kept for the pages that still read it. Always false now: a workspace the
   * user cannot open is never offered or chosen (see `workspaces`).
   */
  denied: boolean;
  /** The workspaces the user can open (for selectors) — never an inaccessible one. */
  workspaces: { id: string; name: string }[];
}

/**
 * Resolves the workspace a page (List, Calendar) should show.
 *
 * Access is the one rule used everywhere (`accessibleWorkspaceIds`): org
 * OWNER/ADMIN inherit every workspace of their org, everyone else — GUESTs
 * included — only the workspaces they were put in. The selector list and the
 * chosen/fallback workspace come from that list only; a requested workspace
 * outside it silently falls back to the first accessible one, and a user with
 * none gets `{ none: true }`.
 */
export async function resolveWorkspaceView(
  wantedId?: string,
): Promise<{ ctx: WorkspaceViewCtx } | { none: true } | { pageRedirect: true }> {
  const user = await currentUser();
  if (!user) return { pageRedirect: true };

  const accessibleIds = await accessibleWorkspaceIds(user.id);
  if (accessibleIds.length === 0) return { none: true };

  const rows = await db.workspace.findMany({
    where: { id: { in: accessibleIds } },
    select: { id: true, name: true, organizationId: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const fallback = rows[0];
  if (!fallback) return { none: true };
  const chosen = (wantedId ? rows.find((w) => w.id === wantedId) : undefined) ?? fallback;
  const workspaces = rows.map((w) => ({ id: w.id, name: w.name }));

  const [orgMember, wsMember] = await Promise.all([
    db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: chosen.organizationId, userId: user.id } },
      select: { role: true },
    }),
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: chosen.id, userId: user.id } },
      select: { role: true },
    }),
  ]);
  // accessible ⇒ org member of the workspace's org; "GUEST" is only a safe floor
  const orgRole = orgMember?.role ?? "GUEST";
  const role = wsMember?.role ?? orgRole;
  return {
    ctx: {
      userId: user.id,
      workspaceId: chosen.id,
      workspaceName: chosen.name,
      orgId: chosen.organizationId,
      orgRole,
      role,
      editable: role !== "GUEST",
      denied: false,
      workspaces,
    },
  };
}

/**
 * People offered in the List page's assignee filter for the chosen workspace
 * (names only, never an email). Org members get the organization's people; an
 * org GUEST (an external partner) only gets the people who share the workspace
 * with them, never the wider staff.
 */
export async function listWorkspacePeople(
  ctx: Pick<WorkspaceViewCtx, "orgId" | "workspaceId" | "orgRole">,
): Promise<{ id: string; name: string }[]> {
  const rows = await db.organizationMember.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(ctx.orgRole === "GUEST"
        ? { user: { workspaceLinks: { some: { workspaceId: ctx.workspaceId } } } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { id: true, name: true } } },
  });
  return rows.map((r) => r.user);
}

export function redirectIfUnauthenticated(): Promise<string | null> {
  return currentUser().then((u) => (u ? u.id : null));
}

// ---------- pure date windows (unit-tested) ----------

export interface DateWindow {
  from: Date;
  to: Date;
}

/** Local-day window [00:00:00.000, 23:59:59.999] for the given date. */
export function dayWindow(d: Date = new Date()): DateWindow {
  const from = new Date(d);
  from.setHours(0, 0, 0, 0);
  const to = new Date(d);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

/** Calendar month window from "YYYY-MM" (UTC bounds). Invalid input → current month. */
export function monthWindow(ym?: string): DateWindow {
  const match = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    ym = new Date().toISOString().slice(0, 7);
    return monthWindow(ym);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { from, to };
}

/** "YYYY-MM" shifted by delta months. Invalid input → current month. */
export function shiftMonth(ym: string | undefined, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  if (!match) return new Date().toISOString().slice(0, 7);
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

// ---------- view-side ordering (pure) ----------

function dueMs(t: ViewTask): number | null {
  return t.dueDate ? t.dueDate.getTime() : null;
}

/** Sort by due date asc; tasks without a due date sink to the end. */
export function sortByDue(rows: ViewTask[]): ViewTask[] {
  return [...rows].sort((a, b) => {
    const da = dueMs(a);
    const db = dueMs(b);
    if (da === null && db === null) return b.updatedAt.getTime() - a.updatedAt.getTime();
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

/** Sort by most recently completed first (for the Completed tab). */
export function sortByCompleted(rows: ViewTask[]): ViewTask[] {
  return [...rows].sort(
    (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
  );
}

// ---------- shared task query (one source for List/Calendar/My Work) ----------

export interface ViewQuery {
  orgId: string;
  assigneeId?: string;
  creatorId?: string;
  projectId?: string;
  workspaceId?: string;
  /**
   * Allow-list of workspaces the caller may see (from `accessibleWorkspaceIds`).
   * When present it ALWAYS applies: an empty list matches nothing, and a
   * `workspaceId` outside the list matches nothing. Absent = no workspace limit.
   */
  workspaceIds?: string[];
  priority?: TaskPriority;
  dueFrom?: Date;
  dueTo?: Date;
  overdueOnly?: boolean;
  openOnly?: boolean;
  completedOnly?: boolean;
  search?: string;
  limit?: number;
}

export interface ViewTask {
  id: string;
  key: string;
  title: string;
  priority: TaskPriority;
  dueDate: Date | null;
  completedAt: Date | null;
  columnId: string;
  columnName: string;
  columnDone: boolean;
  projectId: string;
  projectName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  creatorId: string;
  labelIds: string[];
  updatedAt: Date;
}

/** Single query core for every task view; always org-scoped. */
export async function queryTasksForView(q: ViewQuery): Promise<ViewTask[]> {
  const where: Prisma.TaskWhereInput = {
    orgId: q.orgId,
    archived: false,
  };
  if (q.assigneeId) where.assigneeId = q.assigneeId;
  if (q.creatorId) where.creatorId = q.creatorId;
  if (q.projectId) where.projectId = q.projectId;
  if (q.workspaceIds !== undefined) {
    // the allow-list wins: a single workspaceId can only narrow it, never widen it
    where.workspaceId = {
      in: q.workspaceId ? q.workspaceIds.filter((id) => id === q.workspaceId) : q.workspaceIds,
    };
  } else if (q.workspaceId) {
    where.workspaceId = q.workspaceId;
  }
  if (q.priority) where.priority = q.priority;
  if (q.dueFrom || q.dueTo) {
    where.dueDate = {
      ...(q.dueFrom ? { gte: q.dueFrom } : {}),
      ...(q.dueTo ? { lte: q.dueTo } : {}),
    };
  }
  if (q.overdueOnly) {
    where.dueDate = { lt: new Date() };
    where.completedAt = null;
  }
  if (q.openOnly) where.completedAt = null;
  if (q.completedOnly) where.completedAt = { not: null };
  if (q.search) {
    where.title = { contains: q.search, mode: "insensitive" };
  }

  const rows = await db.task.findMany({
    where,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    take: Math.min(q.limit ?? 200, 500),
    include: {
      ...TASK_INCLUDE,
      project: { select: { id: true, name: true } },
      column: { select: { id: true, name: true, done: true } },
      organization: { select: { keyPrefix: true } },
    },
  });

  return rows.map((t): ViewTask => ({
    id: t.id,
    key: `${t.organization.keyPrefix}-${t.number}`,
    title: t.title,
    priority: t.priority,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    columnId: t.column.id,
    columnName: t.column.name,
    columnDone: t.column.done,
    projectId: t.project.id,
    projectName: t.project.name,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.name ?? null,
    creatorId: t.creatorId,
    labelIds: t.labels.map((l) => l.label.id),
    updatedAt: t.updatedAt,
  }));
}
