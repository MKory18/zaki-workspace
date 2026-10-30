/**
 * iCalendar (RFC 5545) writer for the personal calendar feed «اشتراك التقويم»: pure, no server imports.
 *
 * Three rules a calendar app is strict about, and this file keeps them in ONE place:
 *  - every line ends with CRLF (the last one too);
 *  - a line is at most 75 OCTETS (not characters) before the CRLF; a longer one is folded: CRLF + one space, and the
 *    space counts. Arabic is two octets a letter, so folding by characters would split a letter in half and the
 *    calendar would drop the whole event: `foldLine` counts UTF-8 bytes and never cuts inside a code point;
 *  - in a TEXT value `\` `;` `,` and a line break are escaped (`\\` `\;` `\,` `\n`).
 *
 * Times: a timed event is written in UTC (`20261105T063000Z`), so no VTIMEZONE block is needed; an all-day event is
 * `VALUE=DATE` (a day, with no hour at all: it stays on that day in every zone the calendar app is in).
 */

const CRLF = "\r\n";
/** Octets a content line may hold, before its CRLF (RFC 5545 §3.1). */
export const MAX_LINE_OCTETS = 75;

/** `\` `;` `,` and line breaks of a TEXT value. Other control characters are dropped (a calendar app may reject them). */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

const encoder = new TextEncoder();

/** Number of UTF-8 octets of `text`. */
export function octets(text: string): number {
  return encoder.encode(text).length;
}

/**
 * One content line folded to 75 octets. The first piece holds up to 75, every following one a leading space and up to
 * 74. A code point (a letter, an emoji's surrogate pair) is never split between two pieces. Returned WITHOUT the final CRLF.
 */
export function foldLine(line: string): string {
  if (octets(line) <= MAX_LINE_OCTETS) return line;
  const pieces: string[] = [];
  let current = "";
  let used = 0;
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const size = octets(char);
    if (used + size > limit) {
      pieces.push(current);
      current = "";
      used = 0;
      limit = MAX_LINE_OCTETS - 1; // the leading space of a continuation line takes one octet
    }
    current += char;
    used += size;
  }
  if (current) pieces.push(current);
  return pieces.map((piece, i) => (i === 0 ? piece : " " + piece)).join(CRLF);
}

const two = (n: number) => String(n).padStart(2, "0");

/** `20261105T063000Z` */
export function formatUtc(d: Date): string {
  return `${d.getUTCFullYear().toString().padStart(4, "0")}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}T${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`;
}

/** `YYYY-MM-DD` → `20261105`; null for anything that is not a plain date. */
export function formatDay(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/** The day after `YYYY-MM-DD`, as `YYYYMMDD` (a `VALUE=DATE` event ends on the day AFTER its last day). */
export function nextDay(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return `${d.getUTCFullYear().toString().padStart(4, "0")}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}`;
}

export type IcsWhen =
  /** All day: `YYYY-MM-DD` as the company reads it. */
  | { kind: "date"; day: string }
  /** At an instant, `minutes` long (a calendar app draws a zero-length event as a hairline). */
  | { kind: "time"; at: Date; minutes?: number };

export interface IcsEvent {
  /** Stable for the item for ever (`task-<id>@host`): the calendar app updates the event instead of duplicating it. */
  uid: string;
  /** When the item last changed (never "now": an unchanged feed must be byte-identical, so its ETag holds). */
  stamp: Date;
  summary: string;
  description?: string;
  url?: string;
  when: IcsWhen;
  /** A reminder rings at its time: one VALARM, and only for those. */
  alarm?: { description: string };
}

export interface IcsCalendar {
  name: string;
  /** The company's IANA zone, for `X-WR-TIMEZONE`. */
  timeZone: string;
  events: IcsEvent[];
  prodId?: string;
}

function line(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function eventLines(e: IcsEvent): string[] {
  const out: string[] = ["BEGIN:VEVENT", line("UID", e.uid), line("DTSTAMP", formatUtc(e.stamp))];
  if (e.when.kind === "date") {
    const start = formatDay(e.when.day);
    const end = nextDay(e.when.day);
    if (!start || !end) throw new Error("ical: bad day");
    out.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`);
  } else {
    const minutes = e.when.minutes ?? 30;
    out.push(`DTSTART:${formatUtc(e.when.at)}`, `DTEND:${formatUtc(new Date(e.when.at.getTime() + minutes * 60_000))}`);
  }
  out.push(line("SUMMARY", escapeText(e.summary)));
  if (e.description) out.push(line("DESCRIPTION", escapeText(e.description)));
  if (e.url) out.push(line("URL", e.url));
  out.push("TRANSP:TRANSPARENT");
  if (e.alarm) {
    out.push("BEGIN:VALARM", "ACTION:DISPLAY", line("DESCRIPTION", escapeText(e.alarm.description)), "TRIGGER:PT0M", "END:VALARM");
  }
  out.push("END:VEVENT");
  return out;
}

/** The whole `.ics` text: CRLF between and after every line, every line folded to 75 octets. */
export function buildIcs(cal: IcsCalendar): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    line("PRODID", cal.prodId ?? "-//Zaki Workspace//Calendar Feed//AR"),
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    line("X-WR-CALNAME", escapeText(cal.name)),
    line("X-WR-TIMEZONE", cal.timeZone),
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of cal.events) lines.push(...eventLines(e));
  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}
