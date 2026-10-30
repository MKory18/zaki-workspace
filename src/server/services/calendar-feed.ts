import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit } from "@/server/auth";
import { appUrl } from "@/server/env";
import { memberCan, type Actor } from "@/server/policy/actor";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { projectVisibleWhere, loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { reminderHref, userCanReadMessage } from "@/server/services/reminders";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { buildIcs, type IcsEvent, type IcsWhen } from "@/lib/ical";
import { NOON_HOUR } from "@/lib/today";
import { dayOfInstant } from "@/lib/due-day";
import { resolveTimeZone, zonedParts } from "@/lib/zoned-time";

/**
 * «اشتراك التقويم» — a person's private calendar feed.
 *
 * THE LINK. A person asks for a link; the server makes 32 random bytes, shows the token ONCE and keeps only its SHA-256
 * (`CalendarFeedToken.tokenHash`): a leaked database yields no working link, and a lost link is revoked and made again, never
 * read back. The feed answers to whoever holds the token and to nobody else: there is no session cookie, the token IS the
 * credential (`GET /api/calendar/feed/<token>.ics`).
 *
 * THE FEED IS REBUILT ON EVERY REQUEST, with the checks of a signed-in person made NOW (never remembered in the link):
 *  - the link is not revoked, and the person's session version still equals the one the link was made with (a suspend, an
 *    offboarding, a password reset and «log out everywhere» all bump it: the link dies with the sessions);
 *  - the person is an ACTIVE member of the company, and not an external partner (a guest gets «not found», as the staff
 *    directory does: the feed is for the people of the company);
 *  - the company's `calendarFeed` switch is on.
 * Then it holds ONLY the person's own work, read through the same scoping the calendar page and the task page use
 * (`loadWorkScope` / `taskVisibleWhere` / `projectVisibleWhere`: the spaces the person is in, the teams rule): a person who
 * lost a space stops seeing its items on the next fetch.
 *   - tasks assigned to them (alone or beside others), open, with a due day;
 *   - their own reminders still waiting (the ones on a task or a message they can no longer read are left out, as the
 *     runner dismisses them);
 *   - open milestones of the projects they can see (the «المعالم» switch).
 * Calls have no scheduled time in this app (a call starts when it is rung), so there is nothing of them to publish.
 *
 * WHAT NEVER LEAVES: a task's description, a price, a customer, a CRM record. A task is its title; the description of an
 * event is the project's name and the link back to the item. ⚠️ A title is still words a person typed: the link is as
 * private as the tasks it shows. 🔧 It says so on the card, and «إلغاء» kills a link at once.
 */

export const MAX_ACTIVE_TOKENS = 5;
export const MAX_LABEL = 60;
/** A feed is a window, not an archive: 30 days back to 365 days ahead, and never more than this many events. */
export const FEED_PAST_DAYS = 30;
export const FEED_AHEAD_DAYS = 365;
export const MAX_EVENTS = 2000;
/** The link's token: URL-safe base64 of 32 random bytes (43 characters). The route refuses anything that cannot be one. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;
/** A reminder or a task at a time is drawn this long in the calendar app. */
const TASK_MINUTES = 30;
const REMINDER_MINUTES = 15;
const REMINDER_ROWS = 200;
/** `lastUsedAt` is written at most this often per link, so a polling calendar app is not a write per fetch. */
const USED_WRITE_EVERY_MS = 60_000;

/** The limits of the public door. A calendar app fetches a few times a day; these are far above that. */
export const FEED_LIMITS = {
  /** Every request from one address, known link or not (an office shares one). */
  perIp: { limit: 300, windowMs: 10 * 60_000 },
  /** Every request for one link (counted by the hash of what the path says, so an unknown link is limited too). */
  perToken: { limit: 30, windowMs: 10 * 60_000 },
} as const;

let ipLimiter = new FixedWindowLimiter(FEED_LIMITS.perIp);
let tokenLimiter = new FixedWindowLimiter(FEED_LIMITS.perToken);

/** For tests: forget every counted request. */
export function resetFeedLimitersForTests(): void {
  ipLimiter = new FixedWindowLimiter(FEED_LIMITS.perIp);
  tokenLimiter = new FixedWindowLimiter(FEED_LIMITS.perToken);
}

export const hashFeedToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export interface FeedTokenDto {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** The person's sessions were ended after this link was made (password reset, «log out everywhere»): it no longer works. */
  stale: boolean;
}

function cleanLabel(raw: string | undefined | null): string {
  const label = (raw ?? "").replace(/\s+/g, " ").trim();
  if (label.length > MAX_LABEL) throw new ValidationError([{ path: "label", message: "calfeed.label_long" }]);
  return label || (AR["calfeed.default_label"] as string);
}

/** The person for the session routes: an external partner has no feed; the company's switch must be on. */
async function assertMayHaveFeed(actor: Actor): Promise<void> {
  if (actor.isExternal) throw new ForbiddenError("calfeed.guest");
  await assertFeatureOn(actor.orgId, "calendarFeed");
}

export function feedUrlFor(token: string): string {
  return `${appUrl()}/api/calendar/feed/${token}.ics`;
}

/**
 * Makes a link for the person. The plain token is in the answer ONCE; the table keeps its hash. At most
 * `MAX_ACTIVE_TOKENS` live links per person (a revoked one does not count).
 */
export async function createFeedToken(actor: Actor, input: { label?: string | null }): Promise<{ token: string; url: string; entry: FeedTokenDto }> {
  await assertMayHaveFeed(actor);
  const label = cleanLabel(input.label);
  const live = await db.calendarFeedToken.count({ where: { userId: actor.userId, orgId: actor.orgId, revokedAt: null } });
  if (live >= MAX_ACTIVE_TOKENS) throw new ForbiddenError("calfeed.too_many");
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { tokenVersion: true } });
  const token = randomBytes(32).toString("base64url");
  const row = await db.calendarFeedToken.create({
    data: { orgId: actor.orgId, userId: actor.userId, tokenHash: hashFeedToken(token), label, sessionVersion: user.tokenVersion },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  });
  await audit("calendar_feed.created", { actorId: actor.userId, orgId: actor.orgId, target: row.id });
  return { token, url: feedUrlFor(token), entry: { id: row.id, label: row.label, createdAt: row.createdAt.toISOString(), lastUsedAt: null, stale: false } };
}

/** The person's own live links (never the token, never a revoked link). */
export async function listFeedTokens(actor: Actor): Promise<FeedTokenDto[]> {
  await assertMayHaveFeed(actor);
  const [rows, user] = await Promise.all([
    db.calendarFeedToken.findMany({
      where: { userId: actor.userId, orgId: actor.orgId, revokedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, label: true, createdAt: true, lastUsedAt: true, sessionVersion: true },
    }),
    db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { tokenVersion: true } }),
  ]);
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    stale: r.sessionVersion !== user.tokenVersion,
  }));
}

/** «إلغاء»: the person's own link stops working at once. Somebody else's (or an unknown one) is «not found». */
export async function revokeFeedToken(actor: Actor, id: string, now: Date = new Date()): Promise<void> {
  await assertMayHaveFeed(actor);
  const done = await db.calendarFeedToken.updateMany({
    where: { id, userId: actor.userId, orgId: actor.orgId, revokedAt: null },
    data: { revokedAt: now },
  });
  if (done.count === 0) throw new NotFoundError("calfeed.not_found");
  await audit("calendar_feed.revoked", { actorId: actor.userId, orgId: actor.orgId, target: id });
}

// ---------- the public door ----------

export interface FeedIdentity {
  tokenId: string;
  userId: string;
  orgId: string;
}

/** What a request for a feed may be told: nothing about WHY a link does not work. */
export type FeedAccess = { ok: true; identity: FeedIdentity } | { ok: false; reason: "limited"; retryAfterSec: number } | { ok: false; reason: "not_found" };

/**
 * Counts the request against the address and the link, THEN resolves the link. The same «not found» for a link that never
 * existed, one that was revoked, a person who is suspended, offboarded or a guest, a stale session version and a switched-off
 * feature: nobody learns which.
 */
export async function authorizeFeedRequest(rawToken: string, ip: string, now: Date = new Date()): Promise<FeedAccess> {
  const tokenKey = hashFeedToken(rawToken);
  const byIp = ipLimiter.check(ip);
  const byToken = tokenLimiter.check(tokenKey);
  if (!byIp.ok || !byToken.ok) return { ok: false, reason: "limited", retryAfterSec: Math.max(byIp.retryAfterSec, byToken.retryAfterSec) };
  ipLimiter.hit(ip);
  tokenLimiter.hit(tokenKey);

  if (!TOKEN_SHAPE.test(rawToken)) return { ok: false, reason: "not_found" };
  const row = await db.calendarFeedToken.findUnique({
    where: { tokenHash: tokenKey },
    select: { id: true, orgId: true, userId: true, revokedAt: true, sessionVersion: true, lastUsedAt: true },
  });
  if (!row || row.revokedAt) return { ok: false, reason: "not_found" };

  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: row.orgId, userId: row.userId } },
    select: { status: true, role: true, user: { select: { tokenVersion: true } } },
  });
  if (!member || member.status !== "ACTIVE" || member.role === "GUEST") return { ok: false, reason: "not_found" };
  if (member.user.tokenVersion !== row.sessionVersion) return { ok: false, reason: "not_found" };
  if (!(await isFeatureOn(row.orgId, "calendarFeed"))) return { ok: false, reason: "not_found" };

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= USED_WRITE_EVERY_MS) {
    await db.calendarFeedToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  }
  return { ok: true, identity: { tokenId: row.id, userId: row.userId, orgId: row.orgId } };
}

// ---------- the feed itself ----------

/** When a stored due instant is a DAY (the app stores a picked day as noon of the company's zone), else a moment. */
export function whenOfInstant(instant: Date, timeZone: string, minutes: number): IcsWhen {
  const p = zonedParts(instant, timeZone);
  if (p.hour === NOON_HOUR && p.minute === 0 && p.second === 0) return { kind: "date", day: dayOfInstant(instant, timeZone) };
  return { kind: "time", at: instant, minutes };
}

const link = (path: string): string => `${appUrl()}${path}`;
const ar = (key: string, vars?: Record<string, string | number>): string => interpolate((AR[key] as string | undefined) ?? key, vars);

export interface FeedOptions {
  now?: Date;
  /** Tests lower the cap; the door always uses `MAX_EVENTS`. */
  maxEvents?: number;
}

/** The person's `.ics` text, read from the database now. Throws nothing for an empty week: an empty calendar is a calendar. */
export async function buildFeedFor(who: { userId: string; orgId: string }, opts: FeedOptions = {}): Promise<string> {
  const now = opts.now ?? new Date();
  const cap = opts.maxEvents ?? MAX_EVENTS;
  const from = new Date(now.getTime() - FEED_PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + FEED_AHEAD_DAYS * 86_400_000);

  const org = await db.organization.findUnique({ where: { id: who.orgId }, select: { timezone: true } });
  const timeZone = resolveTimeZone(org?.timezone);
  const host = new URL(appUrl()).hostname;
  const scope = await loadWorkScope(who.userId);
  const [seesTasks, seesProjects, milestonesOn, remindersOn] = await Promise.all([
    memberCan(who, "tasks.view", { spaceGuestsPass: true }),
    memberCan(who, "projects.view", { spaceGuestsPass: true }),
    isFeatureOn(who.orgId, "milestones"),
    isFeatureOn(who.orgId, "reminders"),
  ]);

  const items: { at: number; event: IcsEvent }[] = [];
  const add = (at: Date, event: IcsEvent) => items.push({ at: at.getTime(), event });

  if (seesTasks === true) {
    const tasks = await db.task.findMany({
      where: {
        orgId: who.orgId,
        archived: false,
        completedAt: null,
        dueDate: { gte: from, lte: to },
        OR: [{ assigneeId: who.userId }, { coAssignees: { some: { userId: who.userId } } }],
        AND: [taskVisibleWhere(scope)],
      },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: cap,
      select: { id: true, title: true, dueDate: true, updatedAt: true, project: { select: { name: true } } },
    });
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const url = link(`/tasks/${t.id}`);
      add(t.dueDate, {
        uid: `task-${t.id}@${host}`,
        stamp: t.updatedAt,
        summary: t.title,
        description: `${ar("calfeed.desc_project", { name: t.project.name })}\n${url}`,
        url,
        when: whenOfInstant(t.dueDate, timeZone, TASK_MINUTES),
      });
    }
  }

  if (milestonesOn && seesProjects === true) {
    const milestones = await db.milestone.findMany({
      where: {
        status: "OPEN",
        targetDate: { gte: from, lte: to },
        project: { AND: [projectVisibleWhere(scope)], workspace: { organizationId: who.orgId } },
      },
      orderBy: [{ targetDate: "asc" }, { id: "asc" }],
      take: cap,
      select: { id: true, name: true, targetDate: true, createdAt: true, project: { select: { id: true, name: true } } },
    });
    for (const m of milestones) {
      if (!m.targetDate) continue;
      const url = link(`/projects/${m.project.id}`);
      add(m.targetDate, {
        uid: `milestone-${m.id}@${host}`,
        stamp: m.createdAt,
        summary: `${ar("calfeed.prefix_milestone")}${m.name}`,
        description: `${ar("calfeed.desc_project", { name: m.project.name })}\n${url}`,
        url,
        when: whenOfInstant(m.targetDate, timeZone, TASK_MINUTES),
      });
    }
  }

  if (remindersOn) {
    const rows = await db.reminder.findMany({
      where: { userId: who.userId, orgId: who.orgId, status: "PENDING", dueAt: { gte: from, lte: to } },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: REMINDER_ROWS,
      select: { id: true, title: true, dueAt: true, createdAt: true, taskId: true, messageId: true, message: { select: { conversationId: true } } },
    });
    // a task the person can no longer read: the runner dismisses it, the feed leaves it out
    const taskIds = rows.map((r) => r.taskId).filter((id): id is string => !!id);
    const readable = new Set(
      taskIds.length
        ? (await db.task.findMany({ where: { id: { in: taskIds }, orgId: who.orgId, AND: [taskVisibleWhere(scope)] }, select: { id: true } })).map((t) => t.id)
        : [],
    );
    for (const r of rows) {
      if (r.taskId && !readable.has(r.taskId)) continue;
      if (r.messageId && !(await userCanReadMessage(who.userId, who.orgId, r.messageId))) continue;
      const href = reminderHref(r);
      const url = href ? link(href) : undefined;
      add(r.dueAt, {
        uid: `reminder-${r.id}@${host}`,
        stamp: r.createdAt,
        summary: `${ar("calfeed.prefix_reminder")}${r.title}`,
        description: url ? `${ar("calfeed.desc_reminder")}\n${url}` : ar("calfeed.desc_reminder"),
        ...(url ? { url } : {}),
        when: { kind: "time", at: r.dueAt, minutes: REMINDER_MINUTES },
        alarm: { description: r.title },
      });
    }
  }

  items.sort((a, b) => a.at - b.at || (a.event.uid < b.event.uid ? -1 : 1));
  const events = items.slice(0, cap).map((i) => i.event);
  return buildIcs({ name: ar("calfeed.cal_name"), timeZone, events });
}

/** A strong validator for the feed's text: an unchanged feed answers 304. */
export function feedEtag(body: string): string {
  return `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
}
