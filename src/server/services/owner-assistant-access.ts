import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { boardAccess, type BoardAccess } from "@/server/policy/board";
import { assertFeatureOn } from "@/server/services/features";

/**
 * «مساعد المالك» — WHO MAY OPEN IT, in one place. Every page and every route of the assistant asks `assistantAccess`.
 *
 *   - the switch «مساعد المالك» is on for the company (off: 404 for everybody, the owner included);
 *   - the person is an OWNER-rank member (`actor.isOwner`: the primary owner and his partners), read from the database on
 *     every request. An admin, a lead, a member and a guest get 404 — never 403: the page does not say it exists;
 *   - «لوحة المالك» is on too (the assistant reads the board's numbers), and the board's own access is the owner's.
 *
 * Reading or using it leaves no trace for anybody else: no notification, no «seen», nothing outside the owner's own tables.
 */
export interface AssistantAccess {
  orgId: string;
  userId: string;
  board: BoardAccess;
}

export async function assistantAccess(actor: Actor): Promise<AssistantAccess> {
  await assertFeatureOn(actor.orgId, "ownerAssistant");
  if (!actor.isOwner || actor.isExternal) throw new NotFoundError("assistant.not_found");
  const board = await boardAccess(actor);
  if (board.mode !== "owner") throw new NotFoundError("assistant.not_found");
  return { orgId: actor.orgId, userId: actor.userId, board };
}
