import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { loadCard, toItem } from "@/server/services/cards";
import { canParticipate, canSeeRaters, isInternal } from "@/server/services/card-guards";
import { galleryOf } from "@/server/services/card-attachments";
import { ratingView } from "@/server/services/card-ratings";
import { allowedStatusMoves, statusOf } from "@/lib/cards/status";
import type { CardAbilities, CardPageData } from "@/lib/cards/page";

/**
 * The page inside a card, as ONE read: the card, what the viewer may do on it, the stars, the gallery. Everything the
 * viewer is not meant to know is left out HERE (the screen only draws what it is handed): an external partner gets the
 * card and nothing internal, a plain member never gets the list of who rated what, a person without the library gets no
 * cover and no gallery. The OWNER reads any space silently: no row, no «seen», no notification.
 */
export async function readCardPage(actor: Actor, cardId: string): Promise<CardPageData> {
  const { scope, row } = await loadCard(actor, cardId);
  const live = !row.archivedAt;
  const internal = isInternal(scope);
  const moderate = internal && scope.manager && live;
  const abilities: CardAbilities = {
    write: scope.canWrite && live,
    participate: canParticipate(scope) && live,
    moderate,
    gallery: scope.canWrite && scope.seesFiles && live,
    seeRaters: canSeeRaters(scope, row),
    internal,
    oversight: scope.owner && !scope.member,
    restore: scope.owner && !live,
    statusMoves: moderate ? allowedStatusMoves(statusOf(row.status), { moderator: true }) : [],
  };
  const [space, gallery, rating] = await Promise.all([
    db.workspace.findFirst({ where: { id: row.workspaceId, organizationId: actor.orgId }, select: { name: true } }),
    galleryOf(scope, row),
    ratingView(scope, row),
  ]);
  const card = toItem(row);
  return {
    card: { ...card, coverFileId: scope.seesFiles ? card.coverFileId : null },
    abilities,
    rating,
    gallery,
    spaceId: row.workspaceId,
    spaceName: space?.name ?? "",
  };
}
