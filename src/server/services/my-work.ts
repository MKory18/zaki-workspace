import { db } from "@/server/db";
import { loadWorkScope, narrowScope, scopeSpaceIds, taskVisibleWhere } from "@/server/services/team-scope";
import {
  dayWindow,
  queryTasksForView,
  sortByCompleted,
  sortByDue,
  sortPinnedFirst,
  type ViewQuery,
  type ViewTask,
} from "@/server/services/views";
import { resolveTimeZone } from "@/lib/zoned-time";
import { canWriteInWorkspace } from "@/server/workspace-role";
import { featureOn } from "@/lib/features";

/**
 * The company's zone as the person's My Work page reads it: the first company they are an ACTIVE member
 * of. The page needs it to show and send a due day in the company's calendar (review B5); the tabs
 * themselves are cut per organization, each in its own zone.
 */
export async function myWorkTimeZone(userId: string): Promise<string> {
  const member = await db.organizationMember.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { organization: { select: { timezone: true } } },
  });
  return resolveTimeZone(member?.organization.timezone);
}

/**
 * "My Work": the signed-in user's own tasks, in the workspaces they can open.
 *
 * Rules (the page only renders what this returns):
 *  - today / upcoming / overdue / completed / mine → tasks ASSIGNED to the user
 *  - created                                       → tasks CREATED by the user
 *  - always limited to `accessibleWorkspaceIds` — work in a workspace the user
 *    cannot open never shows, even if it is assigned to / created by them
 *  - `editable` is judged per task's workspace with the same rule as the write routes and the
 *    List/Calendar pages (workspace-role.ts): an org GUEST is read-only everywhere, whatever
 *    their workspace row says, and a workspace GUEST row is read-only too
 */
/** The row as a partner is handed it: without the `reward` key (not even a null). */
function withoutViewReward(task: ViewTask): ViewTask {
  const { reward: _reward, ...rest } = task;
  void _reward;
  return rest;
}

export const MY_WORK_TABS = ["today", "upcoming", "overdue", "completed", "mine", "created"] as const;
export type MyWorkTab = (typeof MY_WORK_TABS)[number];

export interface MyWorkRow {
  task: ViewTask;
  editable: boolean;
}

export type MyWorkData = Record<MyWorkTab, MyWorkRow[]>;

/** Per-tab filters, before the org and the workspace allow-list are applied. */
function tabFilters(userId: string, timeZone: string, now: Date): Record<MyWorkTab, Omit<ViewQuery, "orgId" | "workspaceIds">> {
  // "today" is the company's day (Organization.timezone), not the server's
  const day = dayWindow(now, timeZone);
  const dayAfter = new Date(day.to.getTime() + 1);
  return {
    today: { assigneeId: userId, dueFrom: day.from, dueTo: day.to, openOnly: true },
    upcoming: { assigneeId: userId, dueFrom: dayAfter, openOnly: true },
    // overdue = due before the START of the company's today: a task due earlier today is in "today" only
    overdue: { assigneeId: userId, overdueOnly: true, overdueBefore: day.from },
    completed: { assigneeId: userId, completedOnly: true, limit: 100 },
    mine: { assigneeId: userId, openOnly: true },
    created: { creatorId: userId, openOnly: true },
  };
}

/** Same ordering the page always used: due date (undated last), or latest completion first. */
function sortRows(rows: MyWorkRow[], by: "due" | "completed"): MyWorkRow[] {
  const editableById = new Map(rows.map((r) => [r.task.id, r.editable] as const));
  const tasks = rows.map((r) => r.task);
  // «تثبيت»: a pinned task is first in its tab (only rows the query filled `pinnedAt` for: the switch is on)
  const sorted = sortPinnedFirst(by === "completed" ? sortByCompleted(tasks) : sortByDue(tasks));
  return sorted.map((task) => ({ task, editable: editableById.get(task.id) ?? false }));
}

export async function getMyWork(userId: string, now: Date = new Date(), opts: { spaceId?: string | null } = {}): Promise<MyWorkData> {
  const results = {} as MyWorkData;
  for (const tab of MY_WORK_TABS) results[tab] = [];

  const [memberships, accessible] = await Promise.all([
    // (the organizations' clocks are read after the memberships, below)
    // only organizations where the person is ACTIVE: a suspended or offboarded membership shows nothing
    db.organizationMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: { organizationId: true, role: true },
    }),
    // inside the space the person is in (the page passes it): that space's tasks only
    loadWorkScope(userId).then((scope) => (opts.spaceId === undefined ? scope : narrowScope(scope, opts.spaceId))),
  ]);
  if (memberships.length === 0 || scopeSpaceIds(accessible).length === 0) return results;
  const visible = taskVisibleWhere(accessible);

  // group the accessible workspaces by organization (every query stays org-scoped)
  const [workspaces, wsRows] = await Promise.all([
    db.workspace.findMany({
      where: { id: { in: scopeSpaceIds(accessible) } },
      select: { id: true, organizationId: true },
    }),
    // the user's own row in each of them (none for a space the org OWNER sees without being put in it)
    db.workspaceMember.findMany({
      where: { userId, workspaceId: { in: scopeSpaceIds(accessible) } },
      select: { workspaceId: true, role: true },
    }),
  ]);
  const wsRoleById = new Map(wsRows.map((r) => [r.workspaceId, r.role] as const));
  const idsByOrg = new Map<string, string[]>();
  for (const ws of workspaces) {
    const list = idsByOrg.get(ws.organizationId) ?? [];
    list.push(ws.id);
    idsByOrg.set(ws.organizationId, list);
  }

  const clocks = await db.organization.findMany({
    where: { id: { in: memberships.map((m) => m.organizationId) } },
    select: { id: true, timezone: true, settings: true },
  });
  const settingsByOrg = new Map(clocks.map((o) => [o.id, o.settings] as const));
  const zoneByOrg = new Map(clocks.map((o) => [o.id, resolveTimeZone(o.timezone)] as const));
  // one batch of tab queries per org, run in parallel but merged in membership order
  const perOrg = await Promise.all(
    memberships.map(async (m) => {
      const workspaceIds = idsByOrg.get(m.organizationId);
      if (!workspaceIds || workspaceIds.length === 0) return [];
      const filters = tabFilters(userId, zoneByOrg.get(m.organizationId) ?? resolveTimeZone(null), now);
      // «مهمة بمكافأة» / «تثبيت»: while the company's switch is on; a partner is never given a reward
      const lensOn = featureOn(settingsByOrg.get(m.organizationId), "taskRewards") && m.role !== "GUEST";
      return Promise.all(
        MY_WORK_TABS.map(async (tab) => {
          const found = await queryTasksForView({
            ...filters[tab],
            orgId: m.organizationId,
            workspaceIds,
            visible,
            pinnedFirst: lensOn,
            rewards: lensOn,
          });
          return {
            tab,
            rows: found.map(
              (task): MyWorkRow => ({
                // a row of a space where their own row says GUEST is a partner's row there: no reward field on it at all
                task: wsRoleById.get(task.workspaceId) === "GUEST" ? withoutViewReward(task) : task,
                editable: canWriteInWorkspace(m.role, wsRoleById.get(task.workspaceId)),
              }),
            ),
          };
        }),
      );
    }),
  );
  for (const batch of perOrg) {
    for (const { tab, rows } of batch) results[tab].push(...rows);
  }

  for (const tab of MY_WORK_TABS) {
    results[tab] = sortRows(results[tab], tab === "completed" ? "completed" : "due");
  }
  return results;
}
