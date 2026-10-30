import type { Reminder, ReminderRepeat, ReminderStatus } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { canReadConversation } from "@/server/policy/conversation";
import { assertFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { REPEATS, parseDueInput, snoozeUntil, type SnoozePreset } from "@/lib/reminders/recurrence";

/**
 * «ذكّرني» — a person's reminder for THEMSELVES (never for somebody else), on a task, on a chat message, or on its own.
 *
 * Everything here is the person's own: a reminder is read, snoozed and dismissed only by the one who set it, and the
 * list is only theirs. A reminder on a task or a message may only be set on one the person can read, and the runner
 * checks that again when it is due (src/server/jobs/reminders.ts): the notice carries the person's own words, but
 * the link leads to the task or the message. The company's `reminders` switch closes every door; nothing is lost.
 */

export const MAX_TITLE = 200;
/** A person's reminders still waiting: a list, not a diary. */
export const MAX_PENDING = 200;
/** How long a reminder that fired stays on the list (until the person says «تمّ»). */
const FIRED_VISIBLE_DAYS = 14;
/** Setting a reminder in the past is a mistake, but a minute of clock difference between browser and server is not. */
const PAST_GRACE_MS = 60_000;

export interface ReminderDto {
  id: string;
  title: string;
  dueAt: string;
  repeat: ReminderRepeat;
  status: ReminderStatus;
  /** Fired (the notice was sent) and not yet dismissed: «وصل وقته». */
  fired: boolean;
  taskId: string | null;
  messageId: string | null;
  /** Where the notice leads: the task, the message in its conversation, or nothing. */
  href: string | null;
}

type Row = Pick<Reminder, "id" | "title" | "dueAt" | "repeat" | "status" | "firedAt" | "taskId" | "messageId"> & {
  message?: { conversationId: string } | null;
};

export function reminderHref(row: { taskId: string | null; messageId: string | null; message?: { conversationId: string } | null }): string | null {
  if (row.taskId) return `/tasks/${row.taskId}`;
  if (row.messageId && row.message) return `/chat/${row.message.conversationId}?m=${row.messageId}`;
  return null;
}

function dto(row: Row): ReminderDto {
  return {
    id: row.id,
    title: row.title,
    dueAt: row.dueAt.toISOString(),
    repeat: row.repeat,
    status: row.status,
    fired: row.status === "FIRED",
    taskId: row.taskId,
    messageId: row.messageId,
    href: reminderHref(row),
  };
}

const SELECT = {
  id: true,
  title: true,
  dueAt: true,
  repeat: true,
  status: true,
  firedAt: true,
  taskId: true,
  messageId: true,
  message: { select: { conversationId: true } },
} as const;

/** May this person read this task? The same team-scoped rule the task page itself uses. */
export async function userCanReadTask(userId: string, orgId: string, taskId: string): Promise<boolean> {
  const scope = await loadWorkScope(userId);
  const row = await db.task.findFirst({ where: { id: taskId, orgId, AND: [taskVisibleWhere(scope)] }, select: { id: true } });
  return !!row;
}

/** May this person read this message (it exists in their company, is not deleted, and its conversation is theirs)? */
export async function userCanReadMessage(userId: string, orgId: string, messageId: string): Promise<boolean> {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, select: { orgId: true, conversationId: true, deletedAt: true } });
  if (!msg || msg.orgId !== orgId || msg.deletedAt) return false;
  return canReadConversation(userId, msg.conversationId);
}

export function cleanTitle(raw: string): string {
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) throw new ValidationError([{ path: "title", message: "reminder.title_empty" }]);
  if (title.length > MAX_TITLE) throw new ValidationError([{ path: "title", message: "reminder.title_long" }]);
  return title;
}

export interface CreateReminderInput {
  title: string;
  /** `2026-11-05T09:30` (the company's wall clock, what a datetime-local box sends) or a full instant. */
  dueAt: string;
  repeat?: ReminderRepeat;
  taskId?: string | null;
  messageId?: string | null;
}

export async function createReminder(actor: Actor, input: CreateReminderInput, now: Date = new Date()): Promise<ReminderDto> {
  await assertFeatureOn(actor.orgId, "reminders");
  const title = cleanTitle(input.title);
  const repeat = input.repeat ?? "NONE";
  if (!REPEATS.includes(repeat)) throw new ValidationError([{ path: "repeat", message: "reminder.bad_repeat" }]);
  if (input.taskId && input.messageId) throw new ValidationError([{ path: "taskId", message: "reminder.one_target" }]);
  const dueAt = parseDueInput(input.dueAt, await orgTimeZone(actor.orgId));
  if (!dueAt) throw new ValidationError([{ path: "dueAt", message: "reminder.bad_time" }]);
  if (dueAt.getTime() < now.getTime() - PAST_GRACE_MS) throw new ValidationError([{ path: "dueAt", message: "reminder.past" }]);

  // «not found» for what the person cannot read, as the page itself would say (the answer never tells it exists)
  if (input.taskId && !(await userCanReadTask(actor.userId, actor.orgId, input.taskId))) throw new NotFoundError("task.not_found");
  if (input.messageId && !(await userCanReadMessage(actor.userId, actor.orgId, input.messageId))) throw new NotFoundError("chat.e.not_found");

  const waiting = await db.reminder.count({ where: { userId: actor.userId, orgId: actor.orgId, status: "PENDING" } });
  if (waiting >= MAX_PENDING) throw new ForbiddenError("reminder.too_many");

  const row = await db.reminder.create({
    data: { orgId: actor.orgId, userId: actor.userId, title, dueAt, repeat, taskId: input.taskId ?? null, messageId: input.messageId ?? null },
    select: SELECT,
  });
  return dto(row);
}

/** The person's own list: what waits (soonest first), then what fired and has not been dismissed (newest first). */
export async function listMyReminders(actor: Actor, now: Date = new Date()): Promise<ReminderDto[]> {
  await assertFeatureOn(actor.orgId, "reminders");
  const since = new Date(now.getTime() - FIRED_VISIBLE_DAYS * 86_400_000);
  const [pending, fired] = await Promise.all([
    db.reminder.findMany({ where: { userId: actor.userId, orgId: actor.orgId, status: "PENDING" }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: MAX_PENDING, select: SELECT }),
    db.reminder.findMany({ where: { userId: actor.userId, orgId: actor.orgId, status: "FIRED", firedAt: { gte: since } }, orderBy: [{ firedAt: "desc" }, { id: "desc" }], take: 50, select: SELECT }),
  ]);
  return [...fired, ...pending].map(dto);
}

/** The reminder, only if it is the person's own (anybody else's is «not found»). */
async function ownOf(actor: Actor, id: string) {
  const row = await db.reminder.findFirst({ where: { id, userId: actor.userId, orgId: actor.orgId }, select: { id: true, status: true } });
  if (!row) throw new NotFoundError("reminder.not_found");
  return row;
}

/**
 * Snooze: it is due again in an hour or tomorrow at 09:00 (company time). A reminder that fired, or is waiting, goes
 * back to waiting at that time. ⚠️ A repeating reminder continues from the snoozed time. 🔧 Shown on its card.
 */
export async function snoozeReminder(actor: Actor, id: string, preset: SnoozePreset, now: Date = new Date()): Promise<ReminderDto> {
  await assertFeatureOn(actor.orgId, "reminders");
  const row = await ownOf(actor, id);
  if (row.status === "DISMISSED") throw new ForbiddenError("reminder.dismissed_already");
  const until = snoozeUntil(preset, now, await orgTimeZone(actor.orgId));
  const updated = await db.reminder.update({ where: { id }, data: { status: "PENDING", dueAt: until, snoozedUntil: until }, select: SELECT });
  return dto(updated);
}

/** «تمّ»: the reminder is over (a repeating one stops repeating). Saying it twice changes nothing. */
export async function dismissReminder(actor: Actor, id: string): Promise<void> {
  await assertFeatureOn(actor.orgId, "reminders");
  await ownOf(actor, id);
  await db.reminder.update({ where: { id }, data: { status: "DISMISSED", snoozedUntil: null } });
}
