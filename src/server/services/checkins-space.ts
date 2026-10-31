import { requireActor } from "@/server/policy/actor";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { currentSpace } from "@/server/services/current-space";

/**
 * The space a check-in request is about: the one the request names (`workspaceId`, which the guards in
 * src/server/services/checkins.ts check against the person), or else the space the person is in (the `zk-space` cookie,
 * checked against the spaces they may open). An external partner has none: 403.
 */
export async function resolveSpaceId(workspaceId: string | null | undefined): Promise<string> {
  if (workspaceId) return workspaceId;
  const actor = await requireActor();
  if (actor.isExternal) throw new ForbiddenError("checkins.e.guest_denied");
  const space = await currentSpace(actor);
  if (!space) throw new NotFoundError("workspace.not_found");
  return space.id;
}
