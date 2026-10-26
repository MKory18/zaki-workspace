/**
 * «نتفرّج سوا» — COMMENTS TIED TO A MOMENT OF THE VIDEO.
 *
 * Pure: the session page and the tests read these. A comment is an ordinary message of the session's talk with the
 * second of the video it was written at (`videoAtSec`); a reaction is a comment of one emoji; «لحظة مهمة» is a
 * comment that starts with the pin, and the session's summary is the list of those, in the video's order.
 */

/** The mark of «لحظة مهمة» (a comment starting with it is one). */
export const MOMENT_MARK = "📌";

/** The quick reactions under the video: each is sent as a comment of that one emoji, at the moment. */
export const QUICK_REACTIONS = ["❤️", "😂", "👏", "💡", "😮"] as const;

/** «1:05», «12:40», «1:02:03»: the way a video's player writes a second (digits 0-9; the font may draw them Arabic). */
export function fmtVideoTime(sec: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Is this comment only a reaction (one emoji, nothing else)? It floats over the video when it arrives. */
export function isReaction(body: string | null | undefined): boolean {
  return !!body && (QUICK_REACTIONS as readonly string[]).includes(body.trim());
}

/** Is this comment a «لحظة مهمة»? */
export function isKeyMoment(body: string | null | undefined): boolean {
  return !!body && body.trim().startsWith(MOMENT_MARK);
}

/** The text of a «لحظة مهمة» without its mark («📌 الجملة هاي» → «الجملة هاي»). */
export function momentText(body: string): string {
  return body.trim().replace(MOMENT_MARK, "").trim();
}

/** The session's summary: its «لحظة مهمة» comments that know their second, in the video's order. */
export function keyMoments<T extends { body: string | null; videoAtSec?: number | null; deleted?: boolean }>(messages: readonly T[]): T[] {
  return messages
    .filter((m) => !m.deleted && isKeyMoment(m.body) && typeof m.videoAtSec === "number")
    .sort((a, b) => (a.videoAtSec as number) - (b.videoAtSec as number));
}
