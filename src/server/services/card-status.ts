import { z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { CARD_SELECT, loadCard, toItem } from "@/server/services/cards";
import { assertInternal } from "@/server/services/card-guards";
import { recordCard } from "@/server/services/card-audit";
import { CARD_STATUSES, canMoveStatus, statusOf } from "@/lib/cards/status";
import type { CardItem } from "@/lib/cards/shared";

/**
 * «حالة الاعتماد» (the second of the two systems): مسودة → قيد المراجعة → معتمدة → مؤرشفة, set by a moderator of the space
 * or the OWNER. Every move is written to the log with who and when. It is separate from the stars and from «حذف».
 */

export const statusSchema = z.object({ status: z.enum(CARD_STATUSES) });

export async function setCardStatus(actor: Actor, cardId: string, to: (typeof CARD_STATUSES)[number]): Promise<CardItem> {
  const { scope, row } = await loadCard(actor, cardId);
  assertInternal(scope);
  if (!scope.manager) throw new ForbiddenError("cards.status_moderators_only");
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  const from = statusOf(row.status);
  if (from === to) return toItem(row);
  if (!canMoveStatus(from, to, { moderator: true })) throw new ValidationError([{ path: "status", message: "cards.e.status_move" }]);
  // the move is made only from the status it was read at: two moderators at once cannot both succeed
  const moved = await db.card.updateMany({ where: { id: cardId, orgId: actor.orgId, status: from }, data: { status: to } });
  if (moved.count === 0) throw new ValidationError([{ path: "status", message: "cards.e.status_move" }]);
  await recordCard(actor, row, "status", { from, to });
  return toItem(await db.card.findUniqueOrThrow({ where: { id: cardId }, select: CARD_SELECT }));
}
