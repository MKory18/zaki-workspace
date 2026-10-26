/**
 * «نتفرّج سوا» — «حوّل»: A COMMENT, OR THE WHOLE SESSION, BECOMES WORK.
 *
 * Pure: the session page builds the words here and hands them to the doors that already make ideas, tasks and
 * projects (each with its own rules and the person's «الأقسام» boxes). Whatever is made carries the link back to the
 * same moment of the same video (`/watch/<id>?t=<second>`), so nobody has to look for where it came from.
 */

import { MOMENT_MARK, fmtVideoTime, isKeyMoment, momentText } from "./moments";

/** What an idea may be at most (src/app/api/ideas/route.ts: title 3..140, description up to 2000). */
export const IDEA_TITLE_MAX = 140;
export const DESCRIPTION_MAX = 2000;

/** The session page at one second of its video. */
export function momentLink(sessionId: string, sec: number): string {
  return `/watch/${sessionId}?t=${Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0))}`;
}

/** `?t=754` → 754; anything else (missing, negative, a word) → null. */
export function startFromQuery(t: string | string[] | undefined): number | null {
  const v = Array.isArray(t) ? t[0] : t;
  if (!v || !/^\d{1,6}$/.test(v)) return null;
  const n = Number(v);
  return n <= 86_400 ? n : null;
}

/** A title from the first line, cut at a word, never shorter than an idea allows. */
function titleOf(text: string, fallback: string, max = IDEA_TITLE_MAX): string {
  const line = text.trim().split("\n")[0]!.trim();
  const base = line.length >= 3 ? line : fallback;
  if (base.length <= max) return base;
  const cut = base.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trim()}…`;
}

export interface Draft {
  title: string;
  description: string;
}

/**
 * One comment as an idea or a project: its words are the title (a key moment's without its pin), and the description
 * says who wrote it, in which session, at which second, with the link back to that moment.
 */
export function commentDraft(
  comment: { body: string; authorName: string; videoAtSec?: number | null },
  session: { id: string; title: string },
  words: { momentOf: string },
): Draft {
  const text = isKeyMoment(comment.body) ? momentText(comment.body) : comment.body.trim();
  const at = typeof comment.videoAtSec === "number" ? comment.videoAtSec : 0;
  const where = `🎬 «${session.title}» · ${fmtVideoTime(at)} · ${comment.authorName}`;
  const description = `${text}\n\n${where}\n${momentLink(session.id, at)}`.slice(0, DESCRIPTION_MAX);
  return { title: titleOf(text, `${words.momentOf} «${session.title}»`), description };
}

/**
 * The whole session as an idea or a project: its name is the title, and the description is its summary — every
 * «لحظة مهمة», in the video's order, each with its second and who marked it — then the link to the session.
 */
export function sessionDraft(
  session: { id: string; title: string },
  moments: readonly { body: string | null; authorName: string; videoAtSec?: number | null }[],
  words: { summary: string; momentOf: string },
): Draft {
  const lines = moments
    .filter((m) => typeof m.videoAtSec === "number")
    .map((m) => `- ${fmtVideoTime(m.videoAtSec as number)} ${momentText(m.body ?? "") || MOMENT_MARK} (${m.authorName})`);
  const body = lines.length ? `${words.summary}\n${lines.join("\n")}\n\n` : "";
  const description = `${body}🎬 /watch/${session.id}`.slice(0, DESCRIPTION_MAX);
  return { title: titleOf(session.title, `${words.momentOf} «${session.title}»`), description };
}
