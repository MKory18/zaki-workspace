/**
 * «مهمة بمكافأة» — the pure part: money in integer minor units, the checks, and how a reward is read aloud.
 *
 * Pure (no React, no server imports): the routes validate with it, the screens format with it and the tests pin it.
 *
 * MONEY IS EXACT. An amount is an integer count of MINOR units (cents): 12.50 is 1250. Nothing here ever holds a
 * float that is added or compared: text is cut into whole and fraction digits and joined with integer arithmetic.
 * Two currencies are never added together (`totalsByCurrency` keeps one bucket per currency).
 *
 * The app never moves money: a reward is recorded and approved here, and paid from the payroll.
 */
import { AR } from "./i18n/dict";
import { interpolate } from "./i18n/interpolate";
import { arabicPlural, fmtNumber } from "./format";

/** The currencies the picker offers (the company's own payroll currencies). */
export const REWARD_CURRENCIES = ["USD", "JOD", "SYP", "EUR", "TRY"] as const;
export type RewardCurrency = (typeof REWARD_CURRENCIES)[number];

/** The most one reward may be, in minor units (1,000,000.00): a typo in an amount stops here. */
export const REWARD_MAX_MINOR = 100_000_000;
export const REWARD_NOTE_MAX = 300;
export const REWARD_REASON_MAX = 300;

export const REWARD_STATUSES = ["NONE", "OPEN", "AWARDED", "CANCELLED"] as const;
export type RewardStatus = (typeof REWARD_STATUSES)[number];

/** A task whose reward is real (open, paid out or called off): it is locked for everybody but the owner. */
export function isRewardTaskStatus(status: string | null | undefined): status is "OPEN" | "AWARDED" | "CANCELLED" {
  return status === "OPEN" || status === "AWARDED" || status === "CANCELLED";
}

/** The lists and cards badge a reward that is still real: open or paid out. A called-off one shows on the task's own page only. */
export function listBadgeStatus(status: string | null | undefined): status is "OPEN" | "AWARDED" {
  return status === "OPEN" || status === "AWARDED";
}

/** The Arabic name of a currency (`USD` -> «دولار»). An unknown code is returned as it is: it never throws. */
export function currencyName(code: string | null | undefined): string {
  if (!code) return "";
  return AR[`reward.cur.${code}`] ?? code;
}

export function isRewardCurrency(code: unknown): code is RewardCurrency {
  return typeof code === "string" && (REWARD_CURRENCIES as readonly string[]).includes(code);
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

/** Digits of any script to 0-9, the Arabic decimal and thousands marks to "." and nothing. */
function westernDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[٬,\s]/g, "");
}

/**
 * Typed text to minor units, with integer arithmetic only: "12.5" -> 1250, "٣٠٠" -> 30000, "0.05" -> 5. Anything that is not
 * a plain positive number with at most two decimals is `null` (no rounding: the person is told, not guessed at).
 */
export function amountTextToMinor(text: string): number | null {
  const t = westernDigits(text.trim());
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] === undefined ? 0 : Number(m[2].padEnd(2, "0"));
  const minor = whole * 100 + frac;
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units to the text of the box: 1250 -> "12.5" ... never a float: whole and cents are cut with integer division. */
export function minorToAmountText(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? String(whole) : `${whole}.${String(cents).padStart(2, "0").replace(/0$/, "")}`;
}

/** "1,250" or "1,250.50": the whole part through the one number formatter (Western digits), cents only when there are any. */
export function fmtMinor(minor: number | null | undefined): string {
  if (minor == null || !Number.isInteger(minor) || minor < 0) return "";
  const whole = Math.trunc(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? fmtNumber(whole) : `${fmtNumber(whole)}.${String(cents).padStart(2, "0")}`;
}

/** «150 دينار»: the amount and the currency's Arabic name. */
export function fmtReward(minor: number | null | undefined, currency: string | null | undefined): string {
  const amount = fmtMinor(minor);
  if (!amount) return "";
  return `${amount} ${currencyName(currency)}`.trim();
}

/** The badge: «🏆 مكافأة 150 دينار». */
export function rewardBadgeText(minor: number | null | undefined, currency: string | null | undefined): string {
  return interpolate(AR["reward.badge"] ?? "", { amount: fmtReward(minor, currency) });
}

export interface RewardInput {
  /** Minor units, an integer. */
  amountMinor: number;
  currency: string;
  note?: string | null;
}

/** The reason a reward is refused, as a dictionary key; `null` = fine. The due date is the task's own. */
export function rewardProblem(input: { amountMinor: unknown; currency: unknown; note?: unknown; dueDate: Date | string | null | undefined }): string | null {
  const a = input.amountMinor;
  if (typeof a !== "number" || !Number.isInteger(a) || a <= 0) return "reward.amount_invalid";
  if (a > REWARD_MAX_MINOR) return "reward.amount_too_big";
  if (!isRewardCurrency(input.currency)) return "reward.currency_invalid";
  if (typeof input.note === "string" && input.note.length > REWARD_NOTE_MAX) return "reward.note_long";
  if (!input.dueDate) return "reward.due_required";
  return null;
}

/**
 * The money of several tasks per currency, in minor units: never mixed across currencies. Integer addition only (a sum past
 * the safe integer range is impossible: every amount is capped and the list is bounded).
 */
export function totalsByCurrency(rows: { currency: string | null | undefined; amountMinor: number | null | undefined }[]): { currency: string; minor: number; count: number }[] {
  const by = new Map<string, { minor: number; count: number }>();
  for (const r of rows) {
    if (!r.currency || r.amountMinor == null) continue;
    const cur = by.get(r.currency) ?? { minor: 0, count: 0 };
    cur.minor += r.amountMinor;
    cur.count += 1;
    by.set(r.currency, cur);
  }
  return [...by.entries()].map(([currency, v]) => ({ currency, ...v })).sort((a, b) => a.currency.localeCompare(b.currency));
}

/** «باقي يومين» / «باقي 3 ساعات» / «انتهت المهلة»: the time left to a due moment, in the largest whole unit. */
export function timeLeftText(due: Date | string | number | null | undefined, now: Date = new Date()): string {
  if (due == null) return "";
  const at = due instanceof Date ? due.getTime() : new Date(due).getTime();
  if (Number.isNaN(at)) return "";
  const ms = at - now.getTime();
  if (ms <= 0) return AR["reward.left.over"] ?? "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return AR["reward.left.minute_less"] ?? "";
  let unit: "minute" | "hour" | "day";
  let n: number;
  if (minutes < 60) {
    unit = "minute";
    n = minutes;
  } else if (minutes < 60 * 24) {
    unit = "hour";
    n = Math.floor(minutes / 60);
  } else {
    unit = "day";
    n = Math.floor(minutes / (60 * 24));
  }
  return interpolate(AR[`reward.left.${unit}.${arabicPlural(n)}`] ?? "", { n });
}

/** The pieces of a task the lists and cards need to show the badge: only filled for somebody who may see a reward. */
export interface RewardView {
  rewardStatus: string | null;
  rewardAmountMinor: number | null;
  rewardCurrency: string | null;
}

/** Should the badge be drawn for this task? A reward that is called off shows nothing but to the owner (who sees it struck). */
export function showsRewardBadge(r: Partial<RewardView> | null | undefined, opts: { owner?: boolean } = {}): boolean {
  if (!r || r.rewardAmountMinor == null || !r.rewardCurrency) return false;
  if (r.rewardStatus === "CANCELLED") return opts.owner === true;
  return isRewardTaskStatus(r.rewardStatus);
}
