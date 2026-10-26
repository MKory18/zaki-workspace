import type { WatchSource } from "@/lib/watch/source";
import { watchPageUrl } from "@/lib/watch/source";

/**
 * The name of a pasted video, so the person does not have to type one: YouTube's public oEmbed answer (free, no
 * key, one small request when a session starts). It is a convenience: a slow or failed answer gives null and the
 * session is named by the screen's default.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fake: FetchLike | null = null;

/** Tests answer for YouTube (no network in tests). */
export function setWatchFetchForTests(f: FetchLike | null): void {
  fake = f;
}

export const TITLE_TIMEOUT_MS = 3_000;

export async function videoTitle(source: Pick<WatchSource, "kind" | "ref">): Promise<string | null> {
  const f: FetchLike | null = fake ?? (process.env.NODE_ENV === "test" ? null : fetch);
  if (!f) return null;
  const q = new URLSearchParams({ url: watchPageUrl(source), format: "json" });
  try {
    const res = await f(`https://www.youtube.com/oembed?${q.toString()}`, { signal: AbortSignal.timeout(TITLE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    return title ? title.slice(0, 120) : null;
  } catch {
    return null;
  }
}
