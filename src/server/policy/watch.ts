import { canModerate, canRead, isActiveOf, isOwnerOf, type ConversationFacts, type OrgFacts } from "./conversation";

/**
 * The «نتفرّج سوا» policy (the owner's decisions, 2026-10-26): pure `can*` functions.
 *
 *  - a session's talk is a restricted topic of its space, so SEEING a session is reading that topic (`canRead`):
 *    the people it was started for, and the OWNER silently, like everything;
 *  - starting one: any staff member of the space the person is in (an external partner never: the tab is not
 *    theirs, and nobody may invite them either);
 *  - ending one: whoever started it or holds the remote, the topic's moderators (the space's ADMIN), the OWNER;
 *  - the remote (play, pause, a jump) is the host's, or everybody's of the session with «الكل بيتحكّم»
 *    (src/lib/watch/sync.ts `canPress`); handing it over or opening it to all: the host, the space's ADMIN, the OWNER.
 */

export function canStartWatch(org: OrgFacts | null, inSpace: boolean): boolean {
  if (!isActiveOf(org)) return false;
  if (isOwnerOf(org)) return true;
  return org!.role !== "GUEST" && inSpace;
}

export function canSeeWatch(conv: ConversationFacts | null, org: OrgFacts | null): boolean {
  return canRead(conv, org);
}

export function canHandOverWatch(session: { hostId: string }, viewerId: string, conv: ConversationFacts | null, org: OrgFacts | null): boolean {
  if (!canRead(conv, org)) return false;
  return session.hostId === viewerId || canModerate(conv, org);
}

export function canEndWatch(
  session: { hostId: string; startedById?: string | null },
  viewerId: string,
  conv: ConversationFacts | null,
  org: OrgFacts | null,
): boolean {
  if (!canRead(conv, org)) return false;
  return session.hostId === viewerId || session.startedById === viewerId || canModerate(conv, org);
}
