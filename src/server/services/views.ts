import { Prisma, type TaskPriority } from "@prisma/client";
import { db } from "@/server/db";
import { TASK_INCLUDE } from "@/server/services/tasks";
import { loadWorkScope, scopeSpaceIds, taskVisibleWhere } from "@/server/services/team-scope";
import { canWriteInWorkspace, workspaceRoleOf } from "@/server/workspace-role";

// ---------- workspace access resolution for RSC pages ----------

import { pageUser } from "@/server/auth";
import { log } from "@/server/log";
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  nextZonedDayStart,
  resolveTimeZone,
  zonedDayStart,
  zonedParts,
  zonedWallTime,
} from "@/lib/zoned-time";

/** Zones already warned about, per organization, so a bad stored zone is logged once and not on every request. */
const warnedZones = new Set<string>();
/** For tests: forget the warnings already logged (the set is module state that outlives one test). */
export function resetInvalidZoneWarningsForTests(): void {
  warnedZones.clear();
}

export interface WorkspaceViewCtx {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  orgId: string;
  /** The company's zone (Organization.timezone, resolved): every day boundary of the page is cut there. */
  timeZone: string;
  /** The user's role in that org (not the workspace role): what decides guest-only limits. */
  orgRole: string;
  /** Effective role (workspace member role wins over org role; an org GUEST is a GUEST everywhere). */
  role: string;
  /** Can this person change things here? Same verdict as the write routes (see workspace-role.ts). */
  editable: boolean;
  /**
   * Kept for the pages that still read it. Always false now: a workspace the
   * user cannot open is never offered or chosen (see `workspaces`).
   */
  denied: boolean;
  /** The workspaces the user can open (for selectors) — never an inaccessible one. */
  workspaces: { id: string; name: string }[];
  /** The tasks this person may see (spaces AND teams): pass it as `visible` to `queryTasksForView`. */
  visible: Prisma.TaskWhereInput;
}

/**
 * Resolves the workspace a page (List, Calendar) should show.
 *
 * Access is the one rule used everywhere (`accessibleWorkspaceIds`): the org
 * OWNER sees every workspace of their org, everyone else — ADMINs and GUESTs
 * included — only the workspaces they were put in, and only while they are
 * ACTIVE members. The selector list and the chosen/fallback workspace come from
 * that list only; a requested workspace outside it silently falls back to the
 * first accessible one, and a user with none gets `{ none: true }`.
 */
export async function resolveWorkspaceView(
  wantedId?: string,
): Promise<{ ctx: WorkspaceViewCtx } | { none: true } | { pageRedirect: true }> {
  const user = await pageUser();
  if (!user) return { pageRedirect: true };

  const scope = await loadWorkScope(user.id);
  const accessibleIds = scopeSpaceIds(scope);
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
      select: { role: true, status: true },
    }),
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: chosen.id, userId: user.id } },
      select: { role: true },
    }),
  ]);
  // accessible ⇒ ACTIVE member of the workspace's org; if that does not hold, there is no space for them
  if (!orgMember || orgMember.status !== "ACTIVE") return { none: true };
  const orgRole: string = orgMember.role;
  // an org GUEST is a guest in every workspace, whatever their workspace row says
  const role: string = wsMember ? workspaceRoleOf(orgMember.role, wsMember?.role) : orgRole;
  // the company's clock: resolve the stored zone (a wrong name falls back to the default) and say so once per org+zone
  const stored = (
    await db.organization.findUnique({ where: { id: chosen.organizationId }, select: { timezone: true } })
  )?.timezone;
  const invalid = typeof stored === "string" && stored.trim() !== "" && stored !== DEFAULT_TIME_ZONE && !isValidTimeZone(stored);
  if (invalid) {
    const onceKey = `${chosen.organizationId}:${stored}`;
    if (!warnedZones.has(onceKey)) {
      warnedZones.add(onceKey);
      log.warn("org.timezone.invalid", { orgId: chosen.organizationId, timezone: stored, using: DEFAULT_TIME_ZONE });
    }
  }
  const timeZone = resolveTimeZone(stored);
  return {
    ctx: {
      userId: user.id,
      workspaceId: chosen.id,
      workspaceName: chosen.name,
      orgId: chosen.organizationId,
      timeZone,
      orgRole,
      role,
      editable: canWriteInWorkspace(orgMember.role, wsMember?.role),
      denied: false,
      workspaces,
      visible: taskVisibleWhere(scope),
    },
  };
}

/**
 * People offered in the List page's assignee filter for the chosen workspace
 * (names only, never an email). Org members get the organization's people; an
 * org GUEST (an external partner) only gets the people who share the workspace
 * with them, never the wider staff. Only ACTIVE people are offered: a suspended
 * or offboarded person is not somebody work can be filtered to or handed to.
 */
export async function listWorkspacePeople(
  ctx: Pick<WorkspaceViewCtx, "orgId" | "workspaceId" | "orgRole">,
): Promise<{ id: string; name: string }[]> {
  const rows = await db.organizationMember.findMany({
    where: {
      organizationId: ctx.orgId,
      status: "ACTIVE",
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
  return pageUser().then((u) => (u ? u.id : null));
}

// ---------- pure date windows (unit-tested) ----------

export interface DateWindow {
  from: Date;
  to: Date;
}

/**
 * The day [00:00:00.000, 23:59:59.999] that contains `d`. With a `timeZone` (an organization's
 * `timezone`) it is the COMPANY's day, so "today" means the same on a server that runs on UTC; without
 * one it is the server's local day (the calendar page still uses that).
 */
export function dayWindow(d: Date = new Date(), timeZone?: string): DateWindow {
  if (timeZone) {
    // a mistyped zone must never throw: resolve it to the company default (resolveTimeZone never throws)
    const zone = resolveTimeZone(timeZone);
    const from = zonedDayStart(d, zone);
    return { from, to: new Date(nextZonedDayStart(d, zone).getTime() - 1) };
  }
  const from = new Date(d);
  from.setHours(0, 0, 0, 0);
  const to = new Date(d);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

/** Calendar month window. With a `timeZone` (an organization's `timezone`) the month starts and ends at the COMPANY's midnight; without one it is the UTC month. Invalid `ym` → the month containing `d` (or now). */
export function monthWindow(ym?: string, timeZone?: string, d: Date = new Date()): DateWindow {
  const match = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    // the month containing `d`: in the company's zone when one was given, otherwise the machine's month
    const ymFallback = timeZone
      ? (() => {
          const p = zonedParts(d, resolveTimeZone(timeZone));
          return p.year.toString().padStart(4, "0") + "-" + p.month.toString().padStart(2, "0");
        })()
      : d.toISOString().slice(0, 7);
    return monthWindow(ymFallback, timeZone, d);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (timeZone) {
    const zone = resolveTimeZone(timeZone);
    const from = zonedWallTime({ year, month, day: 1 }, zone);
    const to = new Date(zonedWallTime({ year, month: month + 1, day: 1 }, zone).getTime() - 1);
    return { from, to };
  }
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
  /** The teams rule (`taskVisibleWhere`): when present it ALWAYS applies, on top of everything else. */
  visible?: Prisma.TaskWhereInput;
  priority?: TaskPriority;
  dueFrom?: Date;
  dueTo?: Date;
  overdueOnly?: boolean;
  /**
   * With `overdueOnly`: the line before which an open task is overdue. My Work gives the START of the company's
   * today, the same line as the Today page and the reports (a task due today at 09:00 is "today" at 15:00, never
   * "overdue"). Without it the line is this very moment.
   */
  overdueBefore?: Date;
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
  workspaceId: string;
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
  if (q.visible) where.AND = [q.visible];
  if (q.priority) where.priority = q.priority;
  if (q.dueFrom || q.dueTo) {
    where.dueDate = {
      ...(q.dueFrom ? { gte: q.dueFrom } : {}),
      ...(q.dueTo ? { lte: q.dueTo } : {}),
    };
  }
  if (q.overdueOnly) {
    where.dueDate = { lt: q.overdueBefore ?? new Date() };
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
    workspaceId: t.workspaceId,
    projectId: t.project.id,
    projectName: t.project.name,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.name ?? null,
    creatorId: t.creatorId,
    labelIds: t.labels.map((l) => l.label.id),
    updatedAt: t.updatedAt,
  }));
}
