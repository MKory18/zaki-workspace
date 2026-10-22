import { ConcurrencyGate, FixedWindowLimiter, LOGIN_LIMITS, LOGIN_MAX_CONCURRENT_CHECKS, RateLimitedError } from "./rate-limit";
import { log } from "./log";

/**
 * Brute-force guard for sign-in. Pure bookkeeping (no database, no bcrypt) so the policy can
 * be tested exhaustively with a fake clock.
 *
 *  - admitAddress(ip): every attempt from an address counts, plus a short-burst cap.
 *  - beginAttempt(ip, email): counts the attempt for the (account, address) pair and for the
 *    account overall, and takes a slot for the password check — all in one synchronous step.
 *    Counting BEFORE the check is what makes this safe under concurrency: forty requests that
 *    arrive together cannot all pass a "check" that only a later "hit" would count.
 *  - success(): a good sign-in clears that pair and that account.
 *
 * State is in this process only (one container); see rate-limit.ts.
 */
export interface LoginAttempt {
  /** Call after a CORRECT password: clears the failure counters for this account. */
  success(): void;
  /** Always call (finally): gives the password-check slot back. */
  done(): void;
}

export class LoginGuard {
  private readonly ip: FixedWindowLimiter;
  private readonly burst: FixedWindowLimiter;
  private readonly pair: FixedWindowLimiter;
  private readonly account: FixedWindowLimiter;
  private readonly gate: ConcurrencyGate;

  constructor(
    now: () => number = () => Date.now(),
    limits: typeof LOGIN_LIMITS = LOGIN_LIMITS,
    maxConcurrent: number = LOGIN_MAX_CONCURRENT_CHECKS,
  ) {
    this.ip = new FixedWindowLimiter(limits.perIp, now);
    this.burst = new FixedWindowLimiter(limits.perIpBurst, now);
    this.pair = new FixedWindowLimiter(limits.perAccountAndIp, now);
    this.account = new FixedWindowLimiter(limits.perAccount, now);
    this.gate = new ConcurrencyGate(maxConcurrent);
  }

  /** First step, before the body is read. Throws RateLimitedError. */
  admitAddress(ip: string): void {
    const key = `ip:${ip}`;
    for (const [name, limiter] of [["ip", this.ip], ["burst", this.burst]] as const) {
      const state = limiter.check(key);
      if (!state.ok) {
        log.warn("auth.login_blocked", { by: name, ip });
        throw new RateLimitedError(state.retryAfterSec);
      }
    }
    this.ip.hit(key);
    this.burst.hit(key);
  }

  /** Second step, once the e-mail is known (already lower-cased). Throws RateLimitedError. */
  beginAttempt(ip: string, email: string): LoginAttempt {
    const accountKey = `acct:${email}`;
    const pairKey = `pair:${email}|${ip}`;
    for (const [name, limiter, key] of [
      ["pair", this.pair, pairKey],
      ["account", this.account, accountKey],
    ] as const) {
      const state = limiter.check(key);
      if (!state.ok) {
        log.warn("auth.login_blocked", { by: name, ip });
        throw new RateLimitedError(state.retryAfterSec);
      }
    }
    const release = this.gate.tryAcquire();
    if (!release) {
      log.warn("auth.login_blocked", { by: "busy", ip });
      throw new RateLimitedError(2);
    }
    // Everything above and below runs without an await: the attempt is counted before any other
    // request can look at the counters.
    this.pair.hit(pairKey);
    this.account.hit(accountKey);
    return {
      success: () => {
        this.pair.reset(pairKey);
        this.account.reset(accountKey);
      },
      done: release,
    };
  }
}
