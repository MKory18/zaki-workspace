/**
 * Whether the computer's side menu is folded to its icon rail, remembered in a COOKIE (`zk-sidebar`)
 * and not in localStorage: the width used to come from an effect after the first paint, so a person
 * who had folded the menu saw 256px and then an animated shrink on every hard load. The cookie is
 * read by the server layout, so the first frame is already the right width.
 *
 * Pure (a document or store is handed in, or left out in tests); a bad value reads as «open».
 */

export const SIDEBAR_COOKIE = "zk-sidebar";

/** One year, the whole site, sent only in the same request: a preference, never a secret. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseSidebarCookie(raw: string | null | undefined): boolean {
  return raw === "1";
}

export function writeSidebarCookie(collapsed: boolean, doc: Pick<Document, "cookie"> | null): void {
  if (!doc) return;
  try {
    doc.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {
    /* a blocked document.cookie only means the server reads «open» next time */
  }
}
