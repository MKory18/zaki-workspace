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

/** Generic in-app notification writer (bell UI maps type → localized label). */
export async function pushNotification(input: {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  taskId?: string | null;
  linkUrl?: string | null;
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
}): Promise<void> {
  await pushNotification({
    userId: input.assigneeId,
    type: "task_assigned",
    title: `${input.orgPrefix}-${input.taskNumber}`,
    body: input.title,
    taskId: input.taskId,
    linkUrl: `/tasks/${input.taskId}`,
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
}): Promise<void> {
  await pushNotificationToMany(input.watcherIds.filter((id) => id !== input.authorId), {
    type: "comment",
    title: `${input.orgPrefix}-${input.taskNumber}`,
    body: `${input.authorName}: ${input.body.slice(0, 140)}`,
    taskId: input.taskId,
    linkUrl: `/tasks/${input.taskId}`,
  });
}

/** Someone was added to a workspace / department. */
export async function notifyMembership(input: {
  userIds: readonly string[];
  kind: "workspace" | "department";
  title: string;
  linkUrl: string | null;
  actorId?: string;
}): Promise<void> {
  await pushNotificationToMany(input.userIds.filter((id) => id !== input.actorId), {
    type: input.kind === "workspace" ? "ws_member_added" : "dept_member_added",
    title: input.title,
    linkUrl: input.linkUrl,
  });
}
