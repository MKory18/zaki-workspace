import { getServerT } from "@/lib/i18n/server";
import { offeredToGuests, placeOfferedToGuests, type PlaceKey, type TabKey } from "@/lib/nav/places";
import type { Actor } from "@/server/policy/actor";

/**
 * The one question a page asks before it reads anything for a person who might be an external partner:
 * is this page's tab offered to guests? The answer comes from the map of the five places
 * (src/lib/nav/places.ts), so a page and its menu entry cannot drift apart:
 *
 *     const { actor } = await pageActor();
 *     if (refusedToGuest(actor, "goals")) return <GuestNotice />;
 *
 * It is a rule about guests only. A page may serve more people than its tab is offered to (reports are
 * open to everybody who is not a guest, the tab is shown from LEAD up); that is decided by the page.
 * The API behind the page refuses a guest on its own (`assertNotGuest`), this only keeps the screen honest.
 */
export function refusedToGuest(actor: Pick<Actor, "isExternal">, tab: TabKey): boolean {
  return actor.isExternal && !offeredToGuests(tab);
}

/** The same question for a place that is one page, with no tabs («نتفرّج سوا»). */
export function placeRefusedToGuest(actor: Pick<Actor, "isExternal">, place: PlaceKey): boolean {
  return actor.isExternal && !placeOfferedToGuests(place);
}

/** Shown to an external partner in place of an area that is not shared with them (the same notice /crm and /files show). */
export function GuestNotice() {
  const { t } = getServerT();
  return <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">{t("guest.no_access")}</div>;
}
