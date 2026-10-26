/**
 * «نتفرّج سوا» — WHAT A PASTED LINK PLAYS.
 *
 * Pure (no React, no server imports): the start form reads it to say at once whether a link plays, and the server
 * reads it again before anything is stored (the browser's answer is never trusted). The owner's decision
 * (2026-10-26, «قصدي نحط رابط ونشوف»): links only, nothing is uploaded. YouTube first; another site is a new
 * `kind` here and a player of its own.
 */

export const WATCH_KINDS = ["YOUTUBE"] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

export interface WatchSource {
  kind: WatchKind;
  /** the video's own id at its site */
  ref: string;
  /** where the link asked to start (`?t=1m30s`), in seconds */
  startSec: number;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"]);
/** the paths whose next segment is the id: /shorts/ID, /embed/ID, /live/ID, /v/ID */
const ID_PATHS = new Set(["shorts", "embed", "live", "v"]);

/** «1h2m3s», «90s», «90» → seconds; anything else → 0. */
export function parseStart(raw: string | null | undefined): number {
  if (!raw) return 0;
  const v = raw.trim().toLowerCase();
  if (/^\d+$/.test(v)) return Number(v);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || !(m[1] || m[2] || m[3])) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function asUrl(raw: string): URL | null {
  const text = raw.trim();
  if (!text || text.length > 2000) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** The video a link plays, or null when it is not a link this feature plays. */
export function parseWatchLink(raw: string): WatchSource | null {
  const url = asUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!YOUTUBE_HOSTS.has(host)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be") id = segments[0] ?? null;
  else if (segments[0] === "watch") id = url.searchParams.get("v");
  else if (segments[0] && ID_PATHS.has(segments[0])) id = segments[1] ?? null;
  if (!id || !YOUTUBE_ID.test(id)) return null;

  const startSec = parseStart(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return { kind: "YOUTUBE", ref: id, startSec };
}

/** The canonical page of a video at its site (what is stored and opened «on YouTube»). */
export function watchPageUrl(source: Pick<WatchSource, "kind" | "ref">): string {
  return `https://www.youtube.com/watch?v=${source.ref}`;
}

/**
 * The embedded player's address. The no-cookie host: YouTube keeps no cookie for the person until they play.
 * `playsinline` keeps a phone from jumping to its own full-screen player.
 */
export function watchEmbedUrl(source: Pick<WatchSource, "kind" | "ref">, startSec = 0): string {
  const q = new URLSearchParams({ rel: "0", playsinline: "1", modestbranding: "1" });
  if (startSec > 0) q.set("start", String(Math.floor(startSec)));
  return `https://www.youtube-nocookie.com/embed/${source.ref}?${q.toString()}`;
}

/** The video's still picture (for the list of sessions). */
export function watchThumbUrl(source: Pick<WatchSource, "kind" | "ref">): string {
  return `https://i.ytimg.com/vi/${source.ref}/mqdefault.jpg`;
}
