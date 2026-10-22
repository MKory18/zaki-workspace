/**
 * The open/collapsed/hidden state of the first-steps card, remembered in a COOKIE (`zk-fs`) and
 * not in localStorage: the card used to render nothing until an effect had asked the device, and
 * the page's task list jumped under it. The cookie is read by the SERVER page, so the first HTML
 * already has the card in its state — open, folded to its header, or gone.
 *
 * Pure (the document is handed in, or left out in tests); a bad value reads as «open».
 */

export const FIRST_STEPS_COOKIE = "zk-fs";

export const FIRST_STEPS_STATES = ["open", "collapsed", "hidden"] as const;
export type FirstStepsCookieState = (typeof FIRST_STEPS_STATES)[number];

/** One year, the whole site, sent only in the same request: a preference, never a secret. */
export const FIRST_STEPS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseFirstStepsCookie(raw: string | null | undefined): FirstStepsCookieState {
  return FIRST_STEPS_STATES.find((state) => state === raw) ?? "open";
}

export function firstStepsCookieValue(state: FirstStepsCookieState): string {
  return state;
}

export function firstStepsCookieString(state: FirstStepsCookieState): string {
  return `${FIRST_STEPS_COOKIE}=${firstStepsCookieValue(state)}; path=/; max-age=${FIRST_STEPS_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function writeFirstStepsCookie(state: FirstStepsCookieState, doc: Pick<Document, "cookie"> | null): void {
  if (!doc) return;
  try {
    doc.cookie = firstStepsCookieString(state);
  } catch {
    /* a blocked document.cookie only means the server reads «open» next time */
  }
}
