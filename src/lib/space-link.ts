/**
 * Links that enter a space (src/server/services/current-space.ts). Pure, so the server and the screens share them.
 */

/** A path inside the app to go to after switching: only a local path («/…», never «//host» or a URL). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

/** The link that enters a space and then opens `next` (its «اليوم» by default; a task of that space…). */
export function goHref(spaceId: string, next = "/"): string {
  const q = new URLSearchParams({ space: spaceId });
  if (next !== "/") q.set("next", next);
  return `/go?${q.toString()}`;
}
