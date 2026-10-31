import { AR } from "@/lib/i18n/dict";
import { db } from "@/server/db";
import { pushNotification } from "@/server/notify";

/**
 * The bell of «طلبات الموافقة». Three types: `approval_requested` (it is your turn), `approval_decided` (a step was decided, the
 * request finished or was cancelled) and `approval_changes` (the requester is asked to edit and resubmit).
 *
 * The bell's body (inside the app, behind the sign-in) is the request's title, and who. The Web Push text is GENERIC: it is
 * the same fixed line for every event and carries no title, no name, no amount and no detail — a phone's lock screen shows
 * nothing about the request. An approval never carries an amount into any notification.
 */

export type ApprovalEvent = "requested" | "decided" | "changes";

export interface NoteInput {
  orgId: string;
  workspaceId: string;
  requestId: string;
  title: string;
  /** Who is told. */
  userIds: readonly string[];
  /** The person whose action it is (their name leads the bell's body). */
  actorName?: string | null;
  /** The sentence of the bell's title, a dictionary key under `approvals.note.*`. */
  titleKey: string;
}

const TYPE: Record<ApprovalEvent, string> = {
  requested: "approval_requested",
  decided: "approval_decided",
  changes: "approval_changes",
};

export const PUSH_LINE_KEY = "approvals.note.push";

/** One bell row (and one Web Push) for each person; a failure never undoes the decision that is already committed. */
export async function notifyApproval(event: ApprovalEvent, input: NoteInput): Promise<void> {
  const ids = [...new Set(input.userIds)];
  if (ids.length === 0) return;
  const body = input.actorName ? `${input.actorName} · ${input.title}` : input.title;
  await Promise.all(
    ids.map((userId) =>
      pushNotification({
        userId,
        type: TYPE[event],
        title: AR[input.titleKey] ?? AR["common.error"] ?? "",
        body,
        pushBody: AR[PUSH_LINE_KEY] ?? "",
        linkUrl: `/approvals/${input.requestId}`,
        workspaceId: input.workspaceId,
        organizationId: input.orgId,
      }).catch(() => undefined),
    ),
  );
}

/** Names of people by id (a missing one is simply absent). */
export async function namesOf(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name] as const));
}
