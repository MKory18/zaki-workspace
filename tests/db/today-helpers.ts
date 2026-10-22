import "./scoping-react";
import { vi } from "vitest";
import {
  cloneElement,
  createElement,
  isValidElement,
  type FunctionComponent,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskPriority } from "@prisma/client";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { requireActor, type Actor } from "@/server/policy/actor";
import { getToday } from "@/server/services/today";
import type { TodayData } from "@/lib/today";
import { zonedParts, zonedWallTime } from "@/lib/zoned-time";
import { db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * Fixtures and a page renderer for the Today tests. (Kept apart from helpers.ts on purpose: that file belongs to
 * the harness.)
 *
 * The Today page mounts an ASYNC server component (the first-steps card). Next renders those; react-dom's
 * static renderer, which the other page tests use, does not, so `html()` first walks the tree and replaces every
 * async component by what it returns.
 */

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const isAsync = (fn: unknown): boolean => typeof fn === "function" && Object.prototype.toString.call(fn) === "[object AsyncFunction]";

/** The tree with every async component replaced by its result (client components are left alone: they render on the server too). */
export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((child) => resolveServerTree(child)));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (isAsync(element.type)) {
    const out = await (element.type as unknown as (props: unknown) => Promise<ReactNode>)(element.props);
    return resolveServerTree(out);
  }
  const children = element.props.children;
  if (children === undefined || children === null) return element;
  const resolved = await resolveServerTree(children);
  return Array.isArray(resolved) ? cloneElement(element, undefined, ...resolved) : cloneElement(element, undefined, resolved);
}

/** Renders a server page (async parts included) inside the providers its client parts need. */
export async function html(page: Promise<ReactNode> | ReactNode): Promise<string> {
  const tree = await resolveServerTree(await page);
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Toasts, null, tree as ReactElement)));
}

/** The component types of a page's element tree, in the order they are drawn (depth first). */
export function typesInOrder(node: ReactNode, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const child of node) typesInOrder(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  out.push(node.type);
  typesInOrder((node.props as { children?: ReactNode }).children, out);
  return out;
}

/** What a person can read or hear in the markup: the text between tags and the words of aria-label, title, placeholder and alt. */
export function readable(markup: string): string {
  const parts: string[] = [];
  for (const m of markup.matchAll(/>([^<>]+)</g)) parts.push(m[1] as string);
  for (const m of markup.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]*)"/g)) parts.push(m[1] as string);
  return parts.join("\n");
}

export const hrefsOf = (markup: string): string[] => [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1] as string);

/** Every value of a service result is plain data: nothing a server-to-browser hand-over could choke on. */
export function isPlain(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlain);
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Object.values(value as Record<string, unknown>).every(isPlain);
  }
  return false;
}

// ---------- the world ----------

export const at = (text: string): Date => new Date(text);

/**
 * Noon of the zone's day that contains `now`. Give the service the SAME `now` (`todayFor(userId, now)`): a "noon
 * today" taken from one clock reading and a service that reads the clock again disagree when midnight falls between.
 */
export function todayNoon(timeZone = "UTC", now: Date = new Date()): Date {
  const p = zonedParts(now, timeZone);
  return zonedWallTime({ year: p.year, month: p.month, day: p.day, hour: 12 }, timeZone);
}

/**
 * Runs `fn` with the clock of `Date` stopped at `now` (timers and the database keep real time). It is for a PAGE,
 * which reads the time itself and takes no `now`: the page's day is then the fixtures' day, even when midnight falls
 * between them. Sign in inside `fn`, so that the session is issued on the same clock.
 */
export async function atMoment<T>(now: Date, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"], now });
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

/**
 * One company (owner, admin, member, guest, a team lead) with two spaces, each holding a project with a board:
 *  - `wsIn`  : the member and the lead are in it
 *  - `wsOut` : nobody is in it. Only the OWNER can open it: a space is visible to the people in it and to the
 *              owner, whatever anybody's rank (an ADMIN gets no space by rank).
 * The company's clock is UTC unless a test says otherwise, so the days of the tests are the days of the calendar.
 */
export async function world(timezone = "UTC") {
  const team = await makeTeam();
  await db.organization.update({ where: { id: team.org.id }, data: { timezone } });
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead" });
  const wsIn = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: lead.id }], "مساحة الفريق");
  const wsOut = await makeWorkspace(team.org.id, [], "مساحة مغلقة");
  const inside = await makeProject(wsIn.id, "مشروع الفريق");
  const outside = await makeProject(wsOut.id, "مشروع مغلق");
  return { ...team, lead, wsIn, wsOut, inside, outside };
}
export type World = Awaited<ReturnType<typeof world>>;

export interface PutOptions {
  title?: string;
  assigneeId?: string | null;
  due?: Date | null;
  priority?: TaskPriority;
  completed?: boolean;
  archived?: boolean;
  creatorId?: string;
}

/** A task in the first project of a space of the world. */
export async function put(w: World, place: "in" | "out", o: PutOptions = {}) {
  const ws = place === "in" ? w.wsIn : w.wsOut;
  const made = place === "in" ? w.inside : w.outside;
  const task = await makeTask({
    orgId: w.org.id,
    workspaceId: ws.id,
    projectId: made.project.id,
    boardId: made.board.id,
    columnId: o.completed ? made.done.id : made.todo.id,
    creatorId: o.creatorId ?? w.owner.id,
    assigneeId: o.assigneeId ?? null,
    ...(o.title ? { title: o.title } : {}),
    ...(o.priority ? { priority: o.priority } : {}),
    dueDate: o.due ?? null,
    completedAt: o.completed ? new Date() : null,
  });
  if (o.archived) await db.task.update({ where: { id: task.id }, data: { archived: true } });
  return task;
}

/** Signs in as this person and returns the actor the pages and routes would see. */
export async function actorOf(userId: string): Promise<Actor> {
  await loginAs(userId);
  return requireActor();
}

/** What the Today page would be given for this person at this moment (`now` fixed: the days of a test do not move). */
export async function todayFor(userId: string, now?: Date): Promise<TodayData> {
  return getToday(await actorOf(userId), now ? { now } : {});
}

export const setMember = (orgId: string, userId: string, data: Record<string, unknown>) =>
  db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data });

export const setZone = (orgId: string, timezone: string) => db.organization.update({ where: { id: orgId }, data: { timezone } });

export const idsOf = (rows: { id: string }[]): string[] => rows.map((r) => r.id);

/** Every task id anywhere in a Today result (the three groups). */
export function allTaskIds(data: TodayData): string[] {
  return [...data.tasks.overdue, ...data.tasks.today, ...data.tasks.later].map((t) => t.id);
}
