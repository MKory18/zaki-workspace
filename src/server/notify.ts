import { AR } from "@/lib/i18n/dict";
import { db } from "./db";

/**
 * Only people who are IN receive notifications. A suspended or offboarded person gets nothing new
 * (a comment on their old task would otherwise land in their notifications with its text).
 */
async function activeRecipients(userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db.organizationMember.findMany({
    where: { userId: { in: [...userIds] }, status: "ACTIVE" },
    select: { userId: true },
  });
  const active = new Set(rows.map((r) => r.userId));
  return userIds.filter((id) => active.has(id));
}

/**
 * Generic in-app notification writer (bell UI maps type → localized label).
 *
 * `workspaceId`: the space the notification belongs to (a task's, a topic's, a space one was added to). The bell
 * shows the space the person is in (each space is like a separate site); without one it is personal and shows in
 * every space.
 */
export async function pushNotification(input: {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  taskId?: string | null;
  linkUrl?: string | null;
  workspaceId?: string | null;
}): Promise<void> {
  if ((await activeRecipients([input.userId])).length === 0) return;
  await db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      taskId: input.taskId ?? null,
      linkUrl: input.linkUrl ?? null,
      workspaceId: input.workspaceId ?? null,
    },
  });
}

/** Pushes the same notification to many users (dedupes the actor). */
export async function pushNotificationToMany(
  userIds: readonly string[],
  input: {
    type: string;
    title: string;
    body?: string | null;
    taskId?: string | null;
    linkUrl?: string | null;
    workspaceId?: string | null;
  },
): Promise<void> {
  const unique = await activeRecipients([...new Set(userIds)]);
  if (unique.length === 0) return;
  await db.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      taskId: input.taskId ?? null,
      linkUrl: input.linkUrl ?? null,
      workspaceId: input.workspaceId ?? null,
    })),
  });
}

/** creates an in-app notification for a task assignment. */
export async function notifyAssignment(input: {
  assigneeId: string;
  taskNumber: number;
  orgPrefix: string;
  taskId: string;
  title: string;
  /** the task's space (null: personal) */
  workspaceId: string | null;
}): Promise<void> {
  // the bell prints the stored title VERBATIM (notification-bell.tsx), so the title is the Arabic
  // phrase and the machine label goes in the body (WP-ARABIC2 (a): nothing English on screen)
  await pushNotification({
    userId: input.assigneeId,
    type: "task_assigned",
    title: AR["notif.type.task_assigned"] ?? "إشعار",
    body: `${input.orgPrefix}-${input.taskNumber} · ${input.title}`,
    taskId: input.taskId,
    linkUrl: `/tasks/${input.taskId}`,
    workspaceId: input.workspaceId,
  });
}

/** Comment posted: notify task assignee + creator (never the author). */
export async function notifyComment(input: {
  taskId: string;
  taskNumber: number;
  orgPrefix: string;
  authorId: string;
  authorName: string;
  body: string;
  watcherIds: readonly string[];
  /** the task's space (null: personal) */
  workspaceId: string | null;
}): Promise<void> {
  await pushNotificationToMany(input.watcherIds.filter((id) => id !== input.authorId), {
    type: "comment",
    title: AR["notif.type.comment"] ?? "إشعار",
    body: `${input.authorName}: ${input.body.slice(0, 140)}`,  // the task label rides in the link
    taskId: input.taskId,
    linkUrl: `/tasks/${input.taskId}`,
    workspaceId: input.workspaceId,
  });
}

/** Someone was added to a workspace / department. */
export async function notifyMembership(input: {
  userIds: readonly string[];
  kind: "workspace" | "department";
  title: string;
  linkUrl: string | null;
  actorId?: string;
  /** the space they were added to (a department's notice is personal) */
  workspaceId?: string | null;
}): Promise<void> {
  await pushNotificationToMany(input.userIds.filter((id) => id !== input.actorId), {
    type: input.kind === "workspace" ? "ws_member_added" : "dept_member_added",
    title: input.title,
    linkUrl: input.linkUrl,
    workspaceId: input.workspaceId ?? null,
  });
}
