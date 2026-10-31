/**
 * «التقييمات» — THE PURE PART: the limits, the status order, which version of a review counts, what the employee may see of it.
 * No React, no Next, no database.
 *
 *  - A review = (person, period, reviewer, ratings 1-5 per criterion, a light, strengths, improvement, a private note, a status).
 *  - Status: DRAFT → SUBMITTED → SHARED. Only SHARED reaches the person; the private note never does. A SHARED review is locked:
 *    a correction is a NEW VERSION (the old one stays, and stays what the person saw until the new one is shared).
 *  - One review per reviewer per person per period (the latest version is the live one). Several reviewers may each have their own.
 *  - The score uses, per reviewer, the latest version that is SUBMITTED or SHARED (a draft counts for nothing).
 */

import type { Light } from "./team-score";

export const REVIEW_LIMITS = { text: 1000 } as const;
export const CRITERIA_LIMITS = { name: 40, maxLive: 8, maxAll: 20 } as const;

/** The five the owner named; the company may rename, add (8 in use at most) and retire. `code` is stable, `nameKey` is the first name. */
export const DEFAULT_CRITERIA = [
  { code: "quality", nameKey: "teamdev.criteria.quality" },
  { code: "commitment", nameKey: "teamdev.criteria.commitment" },
  { code: "collaboration", nameKey: "teamdev.criteria.collaboration" },
  { code: "initiative", nameKey: "teamdev.criteria.initiative" },
  { code: "communication", nameKey: "teamdev.criteria.communication" },
] as const;

export type ReviewStatusKey = "DRAFT" | "SUBMITTED" | "SHARED";

/** The next status each one may move to (SHARED is final). */
export const NEXT_STATUS: Readonly<Record<ReviewStatusKey, ReviewStatusKey | null>> = { DRAFT: "SUBMITTED", SUBMITTED: "SHARED", SHARED: null };

export const isOpenStatus = (s: ReviewStatusKey): boolean => s === "DRAFT" || s === "SUBMITTED";

export interface ReviewRow {
  id: string;
  reviewerId: string;
  userId: string;
  period: string;
  version: number;
  status: ReviewStatusKey;
}

/** The live review of each reviewer for a person and period: their highest version, whatever its status. */
export function latestPerReviewer<T extends ReviewRow>(rows: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.userId}|${r.period}|${r.reviewerId}`;
    const cur = best.get(key);
    if (!cur || r.version > cur.version) best.set(key, r);
  }
  return [...best.values()];
}

/** What the SCORE counts: per reviewer, the highest version that is SUBMITTED or SHARED. A newer draft does not replace it. */
export function countedReviews<T extends ReviewRow>(rows: readonly T[]): T[] {
  return latestPerReviewer(rows.filter((r) => r.status !== "DRAFT"));
}

/** What the PERSON sees: per reviewer, the highest SHARED version (a newer unshared one is invisible to them, the old one stays). */
export function sharedReviews<T extends ReviewRow>(rows: readonly T[]): T[] {
  return latestPerReviewer(rows.filter((r) => r.status === "SHARED"));
}

const WORST: Record<Light, number> = { GREEN: 0, AMBER: 1, RED: 2 };

/** The light shown for a person: the reviewers' lights, the most worrying one wins (two reviewers, one green, one amber: amber). */
export function headlineLight(lights: readonly (Light | null | undefined)[]): Light | null {
  let out: Light | null = null;
  for (const l of lights) {
    if (!l) continue;
    if (out === null || WORST[l] > WORST[out]) out = l;
  }
  return out;
}

export interface ReviewBody {
  ratings: Record<string, number>;
  light: Light | null;
  strengths: string;
  improvement: string;
  privateNote: string;
}

/** The part of a review a person may read about themselves: ratings, light, strengths, improvement. NEVER the private note. */
export function employeeProjection<T extends ReviewBody>(review: T): Omit<T, "privateNote"> {
  const { privateNote: _hidden, ...visible } = review;
  void _hidden;
  return visible;
}

/** The ratings of a review, read defensively from stored JSON: only whole numbers 1-5 under string keys. */
export function readRatings(stored: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) out[k] = v;
  }
  return out;
}
