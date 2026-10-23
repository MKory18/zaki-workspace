import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson, passwordChangeSchema } from "@/server/validation";
import { requireUser, startSession } from "@/server/auth";
import { changeOwnPassword } from "@/server/services/onboarding";
import {
  ConcurrencyGate,
  FixedWindowLimiter,
  PASSWORD_CHANGE_MAX_CONCURRENT_CHECKS,
  RateLimitedError,
} from "@/server/rate-limit";

/**
 * Attempts per person. Somebody holding a stolen session cookie must not be able to guess the real
 * password here (and then change it): ten tries, then a pause. Every attempt is counted BEFORE the
 * comparison (requests that arrive together cannot all pass a check that a later "hit" would
 * count), and a successful change starts the count again.
 */
const attempts = new FixedWindowLimiter({ limit: 10, windowMs: 15 * 60_000 });
/** bcrypt is CPU-bound: a couple of comparisons at once in the whole process, the rest wait their turn (429). */
const checks = new ConcurrencyGate(PASSWORD_CHANGE_MAX_CONCURRENT_CHECKS);

/**
 * Change own password (the onboarding's first step and the profile page); the current password
 * must verify. Every other session of this person ends; this browser gets a fresh cookie. If the
 * account changed while the passwords were checked (an owner's reset, ...), nothing is written and
 * the answer is 401 with no cookie.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(passwordChangeSchema, req);
    const user = await requireUser({ allowPending: true });
    const key = `user:${user.id}`;
    // check, take a slot and count in one synchronous step (no await in between)
    const state = attempts.check(key);
    if (!state.ok) throw new RateLimitedError(state.retryAfterSec);
    const release = checks.tryAcquire();
    if (!release) throw new RateLimitedError(2);
    attempts.hit(key);
    let changed: { tokenVersion: number };
    try {
      changed = await changeOwnPassword(user, input.currentPassword, input.newPassword);
    } finally {
      release();
    }
    attempts.reset(key);
    await startSession(user.id, { tv: changed.tokenVersion });
    return NextResponse.json({ ok: true });
  });
}
