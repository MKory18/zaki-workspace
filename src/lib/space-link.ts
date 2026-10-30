/**
 * Links that enter a space (src/server/services/current-space.ts). Pure, so the server and the screens share them.
 */

import { safeNextPath } from "./safe-next";

/**
 * A path inside the app to go to after switching: only a path on THIS site, never `//host`, never a URL.
 *
 * It is `safeNextPath` and nothing else (the rule the sign-in and the middleware already use): a second,
 * weaker copy of this check lived here and answered `"/<TAB>/evil.example"` — a browser drops the tab and
 * lands on `evil.example` — so `/go?next=%2F%09%2Fevil.example` was an open redirect. One rule, one place.
 */
export function safeNext(next: string | null | undefined): string {
  return safeNextPath(next);
}

/** The link that enters a space and then opens `next` (its «اليوم» by default; a task of that space…). */
export function goHref(spaceId: string, next = "/"): string {
  const q = new URLSearchParams({ space: spaceId });
  if (next !== "/") q.set("next", next);
  return `/go?${q.toString()}`;
}
