import { ForbiddenError } from "@/server/auth";
import { loadCard, type CardRow, type CardScope } from "@/server/services/cards";
import type { Actor } from "@/server/policy/actor";

/**
 * The questions the page inside a card asks about its viewer, answered in one place.
 *
 *  - internal: the team's sections (notes, versions, log, links) are never an external partner's;
 *  - participate: stars and notes are for a person IN the space. The OWNER reading a space he is not a member of is in
 *    silent oversight: he leaves nothing behind, so he can neither rate nor write a note until he joins the space;
 *  - moderate: moves the approval status;
 *  - seeRaters: only the OWNER and the card's creator know who rated what.
 */

export function isInternal(scope: CardScope): boolean {
  return !scope.actor.isExternal;
}

export function canParticipate(scope: CardScope): boolean {
  return isInternal(scope) && scope.canWrite && scope.member;
}

export function canSeeRaters(scope: CardScope, card: Pick<CardRow, "createdById">): boolean {
  return isInternal(scope) && (scope.owner || card.createdById === scope.actor.userId);
}

/** 403 unless the viewer is on the team (an external partner never reads the internal sections). */
export function assertInternal(scope: CardScope): void {
  if (!isInternal(scope)) throw new ForbiddenError("cards.internal_only");
}

/** 403 unless the viewer may leave stars or notes (a member of the space; not a guest; not the owner in oversight). */
export function assertParticipate(scope: CardScope): void {
  assertInternal(scope);
  if (!scope.canWrite) throw new ForbiddenError("cards.readonly");
  if (!scope.member) throw new ForbiddenError("cards.oversight_silent");
}

/** A card the viewer may read, with the team's sections open to them. */
export async function loadInternal(actor: Actor, cardId: string): Promise<{ scope: CardScope; row: CardRow }> {
  const loaded = await loadCard(actor, cardId);
  assertInternal(loaded.scope);
  return loaded;
}
