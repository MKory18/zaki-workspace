import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { unreadTotal } from "@/server/chat/unread";
import { actorCan, actorCanWork, type Actor } from "@/server/policy/actor";
import { loadWorkScope, narrowScope, scopeSpaceIds, taskVisibleWhere } from "@/server/services/team-scope";
import { type DashboardMine, type DashboardTeam, type TodayDashboard, weekProgress } from "@/lib/today";
import { nextZonedDayStart, resolveTimeZone, zonedDayStart, zonedParts, zonedWallTime } from "@/lib/zoned-time";

/**
 * The smart cards of «اليوم» — a few numbers, each over what the person may already see.
 *
 * The rules, each proved in tests/db/today-dashboard.test.ts with real rows:
 *
 *  - SCOPE. The same as the page's own list (src/server/services/today.ts): only the spaces the person can open
 *    (the OWNER every space of the company, everybody else only the spaces they were put in), inside the company
 *    they work in now, narrowed to the space they are in (`spaceId`), through the teams rule
 *    (`taskVisibleWhere`). A task, a message or a person of a space they cannot open adds nothing to any number.
 *  - A GUEST (an external partner) gets NO cards at all: no company number, not even their own (`null`).
 *  - THE COMPANY'S DAYS AND WEEK. «Today» and «this week» are counted by `Organization.timezone`, the week from
 *    الأحد (the region's first day), never by the server's clock.
 *  - MINE: open, overdue, due today, finished this week, and the week's progress. Only tasks assigned to the
 *    person, open (or finished this week) and not archived.
 *  - THE TEAM («الفريق هالأسبوع») is for the OWNER and whoever holds users.manage, counts only: finished this
 *    week, due today, and HOW MANY people hold something overdue. No name, no title, no customer, no price.
 *  - UNREAD CHAT is `unreadTotal` itself, the count behind the badge on «الدردشة»: it already leaves out every
 *    topic of a space the person is not in, and the owner's silent reading adds nothing.
 *  - The result is plain data (numbers and booleans): see `TodayDashboard` in src/lib/today.ts.
 *
 * ⚠️ A person who can open no space gets `null` too: nothing to count. 🔧 The page then draws no card.
 */
export interface DashboardOptions {
  now?: Date;
  /**
   * The space the person is in (id and kind, as `currentSpace` answers), or null for none. Leave it out for every
   * space the person can open. A space the person cannot open leaves nothing.
   */
  space?: { id: string; kind: string } | null;
}

export async function getTodayDashboard(actor: Actor, opts: DashboardOptions = {}): Promise<TodayDashboard | null> {
  // an external partner gets no company numbers, whatever the page asks
  if (actor.isExternal) return null;

  const now = opts.now ?? new Date();
  const spaceId = opts.space === undefined ? undefined : (opts.space?.id ?? null);

  const [org, accessible] = await Promise.all([
    db.organization.findUnique({ where: { id: actor.orgId }, select: { timezone: true } }),
    loadWorkScope(actor.userId),
  ]);
  const scope = spaceId === undefined ? accessible : narrowScope(accessible, spaceId);

  // only spaces of THIS company, whatever the scope holds
  const ids = scopeSpaceIds(scope);
  const spaces = ids.length ? await db.workspace.findMany({ where: { id: { in: ids }, organizationId: actor.orgId }, select: { id: true } }) : [];
  if (spaces.length === 0) return null;
  const spaceIds = spaces.map((s) => s.id);

  // the company's clock: today, and the week from الأحد
  const timeZone = resolveTimeZone(org?.timezone);
  const clock = zonedParts(now, timeZone);
  const todayStart = zonedDayStart(now, timeZone);
  const tomorrowStart = nextZonedDayStart(now, timeZone);
  const weekStart = zonedWallTime({ year: clock.year, month: clock.month, day: clock.day - clock.weekday }, timeZone);
  const weekEnd = zonedWallTime({ year: clock.year, month: clock.month, day: clock.day - clock.weekday + 7 }, timeZone);

  const taskSpaces = actorCanWork(actor, "tasks.view") ? spaceIds : [];
  const visible = { orgId: actor.orgId, workspaceId: { in: taskSpaces }, archived: false, AND: [taskVisibleWhere(scope)] } satisfies Prisma.TaskWhereInput;
  const open = { ...visible, completedAt: null } satisfies Prisma.TaskWhereInput;
  const doneThisWeek = { ...visible, completedAt: { gte: weekStart, lt: weekEnd } } satisfies Prisma.TaskWhereInput;

  async function loadMine(): Promise<DashboardMine | null> {
    if (taskSpaces.length === 0) return null;
    const mine = { ...open, assigneeId: actor.userId } satisfies Prisma.TaskWhereInput;
    const [nOpen, nOverdue, nToday, nDone, nLeft] = await Promise.all([
      db.task.count({ where: mine }),
      db.task.count({ where: { ...mine, dueDate: { lt: todayStart } } }),
      db.task.count({ where: { ...mine, dueDate: { gte: todayStart, lt: tomorrowStart } } }),
      db.task.count({ where: { ...doneThisWeek, assigneeId: actor.userId } }),
      // what is still to do this week: late, today, or due before the week ends
      db.task.count({ where: { ...mine, dueDate: { lt: weekEnd } } }),
    ]);
    const { total, percent } = weekProgress(nDone, nLeft);
    return { open: nOpen, overdue: nOverdue, dueToday: nToday, doneWeek: nDone, weekTotal: total, percent };
  }

  async function loadTeam(): Promise<DashboardTeam | null> {
    if (taskSpaces.length === 0) return null;
    const [nDone, nToday, late] = await Promise.all([
      db.task.count({ where: doneThisWeek }),
      db.task.count({ where: { ...open, dueDate: { gte: todayStart, lt: tomorrowStart } } }),
      db.task.groupBy({
        by: ["assigneeId"],
        where: {
          ...open,
          dueDate: { lt: todayStart },
          // somebody who still works here: a suspended or offboarded person is not counted, and neither is a task nobody holds
          assignee: { memberships: { some: { organizationId: actor.orgId, status: "ACTIVE" } } },
        },
      }),
    ]);
    return { doneWeek: nDone, dueToday: nToday, peopleLate: late.length };
  }

  const showTeam = actor.isOwner || actorCan(actor, "users.manage");
  const [mine, team, unreadChat] = await Promise.all([
    loadMine(),
    showTeam ? loadTeam() : Promise.resolve(null),
    unreadTotal({ orgId: actor.orgId, orgRole: actor.role, userId: actor.userId }, spaceId ?? null, opts.space?.kind === "HQ"),
  ]);
  return { mine, unreadChat, team };
}
