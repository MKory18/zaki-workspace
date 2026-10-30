import { z } from "zod";
import { NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { loadCard, type CardRow, type CardScope } from "@/server/services/cards";
import { assertParticipate, canSeeRaters, isInternal } from "@/server/services/card-guards";
import { recordCard } from "@/server/services/card-audit";
import { ratingSummary } from "@/lib/cards/rating";
import type { RatingView } from "@/lib/cards/page";

/**
 * «التقييم» (the first of the two systems): stars 1 to 5 from the people of the space, one per person per card,
 * changeable. The card shows the average and how many rated. WHO gave what is known to the OWNER and the card's creator
 * only; an external partner sees none of it, and the OWNER reading silently (he is not in the space) cannot rate.
 */

export const ratingSchema = z.object({ stars: z.number().int().min(1, "cards.e.stars").max(5, "cards.e.stars") });

/** What the viewer is told about the card's stars (null: an external partner is told nothing). */
export async function ratingView(scope: CardScope, row: Pick<CardRow, "id" | "createdById">): Promise<RatingView | null> {
  if (!isInternal(scope)) return null;
  const rows = await db.cardRating.findMany({
    where: { cardId: row.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { userId: true, stars: true, user: { select: { name: true } } },
  });
  const summary = ratingSummary(rows.map((r) => r.stars));
  return {
    ...summary,
    mine: rows.find((r) => r.userId === scope.actor.userId)?.stars ?? null,
    raters: canSeeRaters(scope, row) ? rows.map((r) => ({ userId: r.userId, name: r.user.name, stars: r.stars })) : null,
  };
}

export async function readRating(actor: Actor, cardId: string): Promise<RatingView | null> {
  const { scope, row } = await loadCard(actor, cardId);
  return ratingView(scope, row);
}

/** Give or change my stars. One row per person per card (the database insists on it too). */
export async function rateCard(actor: Actor, cardId: string, stars: number): Promise<RatingView | null> {
  const { scope, row } = await loadCard(actor, cardId);
  // a deleted card is the owner's to read; nobody rates it
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  assertParticipate(scope);
  const before = await db.cardRating.findUnique({ where: { cardId_userId: { cardId, userId: actor.userId } }, select: { stars: true } });
  if (before?.stars !== stars) {
    await db.cardRating.upsert({
      where: { cardId_userId: { cardId, userId: actor.userId } },
      create: { cardId, userId: actor.userId, stars },
      update: { stars },
    });
    // the log says THAT somebody rated, never how many stars (the stars live in the rating row, read by the owner and creator)
    await recordCard(actor, row, "rated");
  }
  return ratingView(scope, row);
}
