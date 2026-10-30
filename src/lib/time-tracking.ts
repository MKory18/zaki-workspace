import { nextZonedDayStart, zonedParts, zonedWallTime } from "@/lib/zoned-time";

/**
 * «حساب وقت الشغل» — the rules that keep the numbers true, PURE (no React, no server imports) so the server, the screens
 * and the tests read one copy.
 *
 * Every duration is a whole number of SECONDS. Hours and decimals are only ever DRAWN from an integer sum, never
 * accumulated as floats: 0.1 + 0.2 must not happen to somebody's timesheet.
 *
 * A day is the COMPANY's calendar day (`Organization.timezone`), never the server's and never the browser's.
 */

export const MAX_ENTRY_SECONDS = 24 * 3600;
/** The most a person may have logged on one calendar day of the company (manual entries and edits are checked against it). */
export const MAX_DAY_SECONDS = 24 * 3600;
/** A timer left running longer than this is closed at `startedAt + 12h`. */
export const AUTO_STOP_SECONDS = 12 * 3600;
export const AUTO_STOP_MS = AUTO_STOP_SECONDS * 1000;
/** The owner of an entry may change or delete it for this long after creating it; the space's OWNER/ADMIN always may. */
export const EDIT_WINDOW_DAYS = 14;
export const EDIT_WINDOW_MS = EDIT_WINDOW_DAYS * 24 * 3600 * 1000;
export const MAX_NOTE = 500;
/** The most rows one report reads; a wider question must be asked narrower. */
export const MAX_REPORT_ROWS = 20000;

const pad2 = (n: number): string => String(n).padStart(2, "0");

// ───────────────────────────────────────── drawing a duration ─────────────────────────────────────────

/** Whole non-negative seconds, or 0 for anything else (a broken value never draws «NaN»). */
function whole(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

/** `hh:mm`, the minute rounded half up from the integer seconds (`3599` is `01:00`, `29` is `00:00`, `30` is `00:01`). Hours may pass 99. */
export function formatHM(seconds: number): string {
  const minutes = Math.floor((whole(seconds) + 30) / 60);
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** Hours with two digits, `1.50`, rounded half up from the integer seconds by integer arithmetic (no float sum, no `toFixed`). */
export function formatDecimal(seconds: number): string {
  const hundredths = Math.floor((whole(seconds) * 100 + 1800) / 3600);
  return `${Math.floor(hundredths / 100)}.${pad2(hundredths % 100)}`;
}

/** The running clock: `mm:ss` under an hour, `h:mm:ss` from one hour. */
export function formatClock(seconds: number): string {
  const s = whole(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
}

/** `hh:mm (1.50)` — the two readings the report shows side by side. */
export function formatBoth(seconds: number): string {
  return `${formatHM(seconds)} (${formatDecimal(seconds)})`;
}

// ───────────────────────────────────────── reading a duration ─────────────────────────────────────────

/** Hours and minutes typed by a person → seconds. null when it is not 0 < t ≤ 24:00 or the minutes are not 0–59. */
export function secondsOfHM(hours: unknown, minutes: unknown): number | null {
  if (typeof hours !== "number" || typeof minutes !== "number") return null;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || minutes < 0 || minutes > 59) return null;
  const total = hours * 3600 + minutes * 60;
  return total > 0 && total <= MAX_ENTRY_SECONDS ? total : null;
}

/** The whole seconds between two instants (the server's clock on both), never negative. */
export function elapsedSeconds(startedAt: Date, stoppedAt: Date): number {
  const ms = stoppedAt.getTime() - startedAt.getTime();
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

export interface Closed {
  stoppedAt: Date;
  seconds: number;
  /** The timer had run past 12 hours: it is closed at `startedAt + 12h`, and the person sees it and can correct it. */
  autoStopped: boolean;
}

/**
 * How a running timer closes at `now`: at `now`, unless it has run MORE than 12 hours, in which case at `startedAt + 12h`
 * and marked `autoStopped`. One rule for the person's «وقّف», for «ابدأ» on another task and for the job runner.
 */
export function closeTimer(startedAt: Date, now: Date): Closed {
  const limit = new Date(startedAt.getTime() + AUTO_STOP_MS);
  if (now.getTime() > limit.getTime()) return { stoppedAt: limit, seconds: AUTO_STOP_SECONDS, autoStopped: true };
  return { stoppedAt: now.getTime() < startedAt.getTime() ? startedAt : now, seconds: elapsedSeconds(startedAt, now), autoStopped: false };
}

/** The live number the screen draws for a running timer: the SERVER's `startedAt` and `serverNow`, plus the browser's own seconds since it received them. */
export function runningSeconds(startedAtIso: string, serverNowIso: string, receivedAtMs: number, nowMs: number): number {
  const elapsedMs = new Date(serverNowIso).getTime() - new Date(startedAtIso).getTime() + Math.max(0, nowMs - receivedAtMs);
  return elapsedMs > 0 ? Math.min(Math.floor(elapsedMs / 1000), AUTO_STOP_SECONDS) : 0;
}

// ───────────────────────────────────────── the company's days ─────────────────────────────────────────

/** `YYYY-MM-DD` of the company's day that contains this instant. */
export function dayKey(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** `YYYY-MM-DD` → its parts, or null when it is not a real calendar date. */
export function parseDayKey(text: unknown): { year: number; month: number; day: number } | null {
  if (typeof text !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** The `[start, end)` instants of the company's calendar day (a day of 23 or 25 hours when the clocks change, and the cap is still 24 hours). */
export function dayWindow(key: string, timeZone: string): { start: Date; end: Date } | null {
  const d = parseDayKey(key);
  if (!d) return null;
  const start = zonedWallTime({ ...d }, timeZone);
  return { start, end: nextZonedDayStart(start, timeZone) };
}

/** Where a manual entry of this day is anchored: NOON of the day in the company's zone, so no change of the clocks can move it to another day. */
export function dayAnchor(key: string, timeZone: string): Date | null {
  const d = parseDayKey(key);
  return d ? zonedWallTime({ ...d, hour: 12 }, timeZone) : null;
}

/** The day key `days` after (or before, negative) another one. */
export function addDays(key: string, days: number): string {
  const d = parseDayKey(key);
  if (!d) return key;
  const moved = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return `${moved.getUTCFullYear()}-${pad2(moved.getUTCMonth() + 1)}-${pad2(moved.getUTCDate())}`;
}

/** Does adding `adding` seconds to what the day already holds stay within 24 hours? */
export function fitsDay(alreadyLogged: number, adding: number): boolean {
  return alreadyLogged + adding <= MAX_DAY_SECONDS;
}

/** May the owner of an entry still change it (created within 14 days)? */
export function editWindowOpen(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() <= EDIT_WINDOW_MS;
}

export type RangePreset = "week" | "month";

/** The current week (it begins on the first day the platform counts, الأحد) or month of the company, as inclusive day keys. */
export function presetRange(preset: RangePreset, now: Date, timeZone: string): { from: string; to: string } {
  const p = zonedParts(now, timeZone);
  const today = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  if (preset === "week") {
    const from = addDays(today, -p.weekday);
    return { from, to: addDays(from, 6) };
  }
  const last = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  return { from: `${p.year}-${pad2(p.month)}-01`, to: `${p.year}-${pad2(p.month)}-${pad2(last)}` };
}

// ───────────────────────────────────────── totals ─────────────────────────────────────────

export interface Totalled {
  seconds: number;
}

/** An integer sum: the report's total is exactly the sum of its rows. */
export function sumSeconds(rows: readonly Totalled[]): number {
  let total = 0;
  for (const r of rows) total += whole(r.seconds);
  return total;
}

export interface Group {
  key: string;
  label: string;
  seconds: number;
}

/** Sums per key, largest first (ties by label, then key), so a report reads the same each time. */
export function groupTotals<T extends Totalled>(rows: readonly T[], keyOf: (row: T) => { key: string; label: string }): Group[] {
  const map = new Map<string, Group>();
  for (const row of rows) {
    const { key, label } = keyOf(row);
    const cur = map.get(key);
    if (cur) cur.seconds += whole(row.seconds);
    else map.set(key, { key, label, seconds: whole(row.seconds) });
  }
  return [...map.values()].sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label, "ar") || a.key.localeCompare(b.key));
}

// ───────────────────────────────────────── CSV ─────────────────────────────────────────

/** The byte order mark Excel needs to read UTF-8 (Arabic) correctly. */
export const CSV_BOM = "\uFEFF";

/**
 * One CSV cell. ⚠️ A cell that starts with = + - @ (or a tab or a carriage return) is read by Excel as a FORMULA, and
 * a task title or a note is typed by people: 🔧 it gets a leading apostrophe, and the cell is quoted when it holds a
 * comma, a quote or a line break.
 */
export function csvCell(value: string | number): string {
  let text = typeof value === "number" ? String(value) : value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole file: BOM, then CRLF-separated rows. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
