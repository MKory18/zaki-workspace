import type { ProjectStatus, TaskPriority } from "@prisma/client";
import { zonedParts, zonedWallTime } from "@/lib/zoned-time";

/** The hour a quick-added task is due at: noon in the company's zone. */
export const NOON_HOUR = 12;

/**
 * «اليوم» — the plain data the Today page is made of, and the small pure rules around it. No React, no database:
 * the service (src/server/services/today.ts) fills these shapes, the parts in src/components/today read them, and
 * the tests hold both. Everything here is a string, a number, a boolean or a list of those, so a server component
 * can hand it to a client component as it is; every date has already been turned into the words a person reads
 * (in the company's zone, by the service), so the browser does no date maths of its own and cannot disagree
 * with the server about what "today" is.
 */

/** How many of each thing the page shows (the rest is counted and linked: «عرض الباقي»). */
export const TODAY_LIMITS = {
  overdue: 8,
  today: 15,
  later: 5,
  projects: 6,
  pulse: 5,
  quickTargets: 30,
} as const;

/** The longest task title the API takes (POST /api/tasks). */
export const TASK_TITLE_MAX = 280;

// ───────────────────────────────────────── the greeting ─────────────────────────────────────────

export type GreetingPeriod = "morning" | "evening";

/** «صباح الخير» from five in the morning until noon; «مساء الخير» for the rest of the day and the night. */
export function greetingPeriod(hour: number): GreetingPeriod {
  return hour >= 5 && hour < 12 ? "morning" : "evening";
}

/**
 * The words that start a name and cannot stand alone: «عبد» is «servant», and the name is «عبد الله»; «أبو نزار» and
 * «أم خالد» are one name too. Compared without diacritics and with one kind of alef.
 */
const NAME_JOINERS: ReadonlySet<string> = new Set(["عبد", "ابو", "ام"]);

const plainWord = (word: string): string => word.replace(/[ً-ٰٟ]/g, "").replace(/[أإآ]/g, "ا");

/**
 * The first name: the greeting is «صباح الخير يا أحمد», not «يا أحمد الزكي»; and «صباح الخير يا عبد الله», never
 * «يا عبد». A name written as one word («عبدالله») is one word already.
 */
export function firstNameOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => word !== "");
  const first = words[0];
  if (first === undefined) return "";
  const second = words[1];
  return second !== undefined && NAME_JOINERS.has(plainWord(first)) ? `${first} ${second}` : first;
}

// ───────────────────────────────────────── the shapes ─────────────────────────────────────────

export interface TodayTask {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  priority: TaskPriority;
  /** The priority in Arabic. */
  priorityLabel: string;
  /** The due day as people say it («أمس» «بكرا» «قبل 3 أيام»), counted in the company's zone; empty without a due date. */
  dueLabel: string;
  /** May the person finish it? (The server decides again when they try.) */
  editable: boolean;
}

export interface TodayCounts {
  open: number;
  overdue: number;
  today: number;
  later: number;
}

export interface TodayTasks {
  /** Due before today, the most overdue first. */
  overdue: TodayTask[];
  /** Due today, earliest first. */
  today: TodayTask[];
  /** Due after today, nearest first, then the ones with no due date. */
  later: TodayTask[];
  /** The real totals: a list above may be shorter than its count. */
  counts: TodayCounts;
}

export interface TodayProject {
  id: string;
  name: string;
  status: ProjectStatus;
  /** The status in Arabic. */
  statusLabel: string;
  /** The project's open tasks; for an external partner only their own. */
  openTasks: number;
}

export interface PulseTask {
  id: string;
  title: string;
  projectName: string;
  assigneeName: string;
  dueLabel: string;
}

/** «نبض الفريق»: the owner's and the people managers' view of the spaces they can open. */
export interface TodayPulse {
  open: number;
  overdue: number;
  /** The most overdue tasks held by somebody who is still active. */
  worst: PulseTask[];
}

export interface QuickAddTarget {
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  boardId: string;
}

/** What the quick add needs to build a request for the existing POST /api/tasks. */
export interface TodayQuickAddData {
  /** The person: a task added from Today is their own. */
  assigneeId: string;
  /** Where a task can go: a project with a board. May be empty (the form then says what to do first). */
  targets: QuickAddTarget[];
  /** Noon today and noon tomorrow in the company's zone, as ISO instants. */
  dueToday: string;
  dueTomorrow: string;
}

export interface TodayData {
  /** The zone the days were counted in. */
  timeZone: string;
  greeting: { period: GreetingPeriod; firstName: string; hour: number };
  /** «الخميس 22 تشرين الأول 2026» */
  dateLabel: string;
  /** Is the person in any space at all? */
  hasSpaces: boolean;
  /** May they open a space of their own (`spaces.create`)? It changes what «no space yet» says to them. */
  canCreateSpaces: boolean;
  /** An external partner: their own tasks and projects, no company numbers, nothing to add. */
  isExternal: boolean;
  tasks: TodayTasks;
  projects: TodayProject[];
  /** Only for the owner and whoever holds users.manage, and only once they can open a space (no space, nothing to take the pulse of). */
  pulse: TodayPulse | null;
  /** Only for somebody who may add tasks in at least one space they can open. */
  quickAdd: TodayQuickAddData | null;
}

// ───────────────────────────────────────── the quick add's request ─────────────────────────────────────────

export type QuickDue = "today" | "tomorrow" | "none";

/** The body of POST /api/tasks that the quick add sends. */
export interface QuickTaskBody {
  workspaceId: string;
  projectId: string;
  boardId: string;
  title: string;
  assigneeId: string;
  dueDate?: string;
}

/** At most `max` characters, never leaving the first half of an emoji at the end. */
function cutAt(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * The request for the task the person typed, or null when there is nothing to send (a blank title, or a project
 * that is not on the list). Smart defaults, as the owner asked: the task is theirs, and due today unless they say
 * otherwise. The server checks everything again.
 *
 * The noon is computed HERE, at submit time, in the company's zone (`timeZone`, which the page
 * already carries) — not read from the server render. A phone app resumed the next morning must
 * not bake yesterday's noon into a new task. `now` is injectable so a test can stand in for the
 * clock; it defaults to the real present.
 */
export function quickTaskBody(
  quickAdd: TodayQuickAddData,
  input: { projectId: string; title: string; due: QuickDue; timeZone: string; now?: Date },
): QuickTaskBody | null {
  const title = cutAt(input.title.trim(), TASK_TITLE_MAX).trimEnd();
  if (title === "") return null;
  const target = quickAdd.targets.find((x) => x.projectId === input.projectId);
  if (!target) return null;
  let dueDate: string | undefined;
  if (input.due !== "none") {
    const clock = input.now ?? new Date();
    const p = zonedParts(clock, input.timeZone);
    const day = input.due === "today" ? p.day : p.day + 1;
    dueDate = zonedWallTime({ year: p.year, month: p.month, day, hour: NOON_HOUR }, input.timeZone).toISOString();
  }
  return {
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    boardId: target.boardId,
    title,
    assigneeId: quickAdd.assigneeId,
    ...(dueDate ? { dueDate } : {}),
  };
}
