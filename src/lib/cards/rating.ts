/** «التقييم»: stars from the people of the space. Pure. */

export const MIN_STARS = 1;
export const MAX_STARS = 5;

/** A whole number from 1 to 5, or null. */
export function cleanStars(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= MIN_STARS && v <= MAX_STARS ? v : null;
}

export interface RatingSummary {
  /** One decimal (4.3); null while nobody has rated. */
  average: number | null;
  /** How many people rated. */
  count: number;
}

/** The average of the stars given (one per person) and how many gave them. */
export function ratingSummary(stars: readonly number[]): RatingSummary {
  const valid = stars.filter((s) => cleanStars(s) !== null);
  if (valid.length === 0) return { average: null, count: 0 };
  const sum = valid.reduce((a, b) => a + b, 0);
  return { average: Math.round((sum / valid.length) * 10) / 10, count: valid.length };
}
