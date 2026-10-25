import { accessibleWorkspaceIds } from "@/server/services/access";
import { currentSpace, type SpaceSubject } from "@/server/services/current-space";

/**
 * WHERE A SPACE'S OWN THINGS ARE READ (the owner's decision, 2026-10-25: each space is like a separate site) — for the
 * goals, the daily routines, the customers and the opportunities: inside a space, the ones that belong to it; inside
 * «الشركة» also the ones from before spaces had their own (no space). One rule, one place.
 */
export interface SpacePlace {
  spaceId: string | null;
  isHq: boolean;
}

/** The place of the person: the space they are in. */
export async function placeOf(who: SpaceSubject): Promise<SpacePlace> {
  const space = await currentSpace(who);
  return { spaceId: space?.id ?? null, isHq: space?.kind === "HQ" };
}

/** A WHERE for any model with a `workspaceId`: the rows read in this place. No space: nothing. */
export function placeWhere(place: SpacePlace) {
  if (!place.spaceId) return { id: { in: [] as string[] } };
  return place.isHq ? { OR: [{ workspaceId: place.spaceId }, { workspaceId: null }] } : { workspaceId: place.spaceId };
}

/** A WHERE for one row by id: of one of the person's spaces, or from before spaces had their own (anything else is «not found»). */
export async function mySpacesWhere(userId: string) {
  return { OR: [{ workspaceId: null }, { workspaceId: { in: await accessibleWorkspaceIds(userId) } }] };
}
