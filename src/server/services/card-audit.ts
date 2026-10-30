import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import type { LogAction } from "@/lib/cards/page";

/** Every card entry of the audit log starts with this, then the `LogAction` (`card.edited`). */
export const CARD_AUDIT_PREFIX = "card.";

/**
 * One line of «السجل» for a card, written to the existing AuditLog (no table of its own): who, what, when, with the
 * company and the space so the owner's trails find it. What goes in `meta` is only what a line needs to say — never
 * anybody's stars, never a private note. A failed write is logged and swallowed: the thing the person did has already
 * happened and must not look as if it failed.
 */
export async function recordCard(
  actor: { userId: string; orgId: string },
  card: { id: string; workspaceId: string },
  action: LogAction,
  meta?: Prisma.InputJsonValue,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: `${CARD_AUDIT_PREFIX}${action}`,
        actorId: actor.userId,
        orgId: actor.orgId,
        target: card.id,
        workspaceId: card.workspaceId,
        meta: meta ?? Prisma.JsonNull,
      },
    });
  } catch (err) {
    log.error("cards.audit_failed", { action, message: err instanceof Error ? err.message : String(err) });
  }
}
