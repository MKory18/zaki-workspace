import { db } from "@/server/db";
import { accessibleWorkspaceIds } from "@/server/services/access";
import {
  dayWindow,
  queryTasksForView,
  sortByCompleted,
  sortByDue,
  type ViewQuery,
  type ViewTask,
} from "@/server/services/views";

/**
 * "My Work": the signed-in user's own tasks, in the workspaces they can open.
 *
 * Rules (the page only renders what this returns):
 *  - today / upcoming / overdue / completed / mine → tasks ASSIGNED to the user
 *  - created                                       → tasks CREATED by the user
 *  - always limited to `accessibleWorkspaceIds` — work in a workspace the user
 *    cannot open never shows, even if it is assigned to / created by them
 *  - org GUESTs keep read-only rows (`editable: false`), judged per task's org
 */
export const MY_WORK_TABS = ["today", "upcoming", "overdue", "completed", "mine", "created"] as const;
export type MyWorkTab = (typeof MY_WORK_TABS)[number];

export interface MyWorkRow {
  task: ViewTask;
  editable: boolean;
}

export type MyWorkData = Record<MyWorkTab, MyWorkRow[]>;

/** Per-tab filters, before the org and the workspace allow-list are applied. */
function tabFilters(userId: string): Record<MyWorkTab, Omit<ViewQuery, "orgId" | "workspaceIds">> {
  const day = dayWindow();
  const dayAfter = new Date(day.to.getTime() + 1);
  return {
    today: { assigneeId: userId, dueFrom: day.from, dueTo: day.to, openOnly: true },
    upcoming: { assigneeId: userId, dueFrom: dayAfter, openOnly: true },
    overdue: { assigneeId: userId, overdueOnly: true },
    completed: { assigneeId: userId, completedOnly: true, limit: 100 },
    mine: { assigneeId: userId, openOnly: true },
    created: { creatorId: userId, openOnly: true },
  };
}

/** Same ordering the page always used: due date (undated last), or latest completion first. */
function sortRows(rows: MyWorkRow[], by: "due" | "completed"): MyWorkRow[] {
  const editableById = new Map(rows.map((r) => [r.task.id, r.editable] as const));
  const tasks = rows.map((r) => r.task);
  const sorted = by === "completed" ? sortByCompleted(tasks) : sortByDue(tasks);
  return sorted.map((task) => ({ task, editable: editableById.get(task.id) ?? false }));
}

export async function getMyWork(userId: string): Promise<MyWorkData> {
  const results = {} as MyWorkData;
  for (const tab of MY_WORK_TABS) results[tab] = [];

  const [memberships, accessible] = await Promise.all([
    db.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true, role: true },
    }),
    accessibleWorkspaceIds(userId),
  ]);
  if (memberships.length === 0 || accessible.length === 0) return results;

  // group the accessible workspaces by organization (every query stays org-scoped)
  const workspaces = await db.workspace.findMany({
    where: { id: { in: accessible } },
    select: { id: true, organizationId: true },
  });
  const idsByOrg = new Map<string, string[]>();
  for (const ws of workspaces) {
    const list = idsByOrg.get(ws.organizationId) ?? [];
    list.push(ws.id);
    idsByOrg.set(ws.organizationId, list);
  }

  const filters = tabFilters(userId);
  // one batch of tab queries per org, run in parallel but merged in membership order
  const perOrg = await Promise.all(
    memberships.map(async (m) => {
      const workspaceIds = idsByOrg.get(m.organizationId);
      if (!workspaceIds || workspaceIds.length === 0) return [];
      const editable = m.role !== "GUEST";
      return Promise.all(
        MY_WORK_TABS.map(async (tab) => {
          const found = await queryTasksForView({
            ...filters[tab],
            orgId: m.organizationId,
            workspaceIds,
          });
          return { tab, rows: found.map((task): MyWorkRow => ({ task, editable })) };
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
