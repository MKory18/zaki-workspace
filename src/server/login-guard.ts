import {
  ConcurrencyGate,
  FixedWindowLimiter,
  LOGIN_KNOWN_ADDRESSES,
  LOGIN_LIMITS,
  LOGIN_MAX_CONCURRENT_CHECKS,
  RateLimitedError,
} from "./rate-limit";
import { log } from "./log";

/**
 * Brute-force guard for sign-in. Pure bookkeeping (no database, no bcrypt) so the policy can
 * be tested exhaustively with a fake clock (tests/login-guard.test.ts).
 *
 *  - admitAddress(ip), before the body is read: the address's FAILED attempts (counted now, given
 *    back by success()) and its short burst of attempts of any kind.
 *  - beginAttempt(ip, { typed, userId }), once the route knows what was typed and which account it
 *    names (a plain database read, no password check yet): counts the attempt for
 *      * the (typed text, address) pair — the lock that stops a person guessing. Keyed by the TYPED
 *        text, so a locked username tells a stranger nothing about which e-mail is the same person;
 *      * the account as a whole, from every address — keyed "u:<userId>" for a real account (so
 *        alternating its username and e-mail cannot double the cap) and "t:<typed text>" for text
 *        that names nobody (a separate key space: typing somebody's internal id never counts
 *        against them). An address the person signed in from before is NOT held by this cap, only
 *        by its pair: a stranger with a few addresses cannot lock the owner out of his office;
 *    and takes a slot for the password check — all in one synchronous step. Counting BEFORE the
 *    check is what makes this safe under concurrency: forty requests that arrive together cannot
 *    all pass a "check" that only a later "hit" would count.
 *  - success(): the password was right: that pair starts again, the attempt is given back to the
 *    account and the address, and the address is remembered as known for the account.
 *
 * State is in this process only (one container); see rate-limit.ts.
 */
export interface LoginAttempt {
  /** Call after a CORRECT password. */
  success(): void;
  /** Always call (finally): gives the password-check slot back. */
  done(): void;
}

/** What an attempt is about: the text typed (lower-cased) and the account it names, if any. */
export interface AttemptSubject {
  typed: string;
  userId: string | null;
}

/** Bounded memory of the addresses each account signed in from (least recently used goes first). */
class KnownAddresses {
  private readonly byAccount = new Map<string, string[]>();

  constructor(private readonly bounds: { perAccount: number; accounts: number }) {}

  has(account: string, ip: string): boolean {
    return this.byAccount.get(account)?.includes(ip) ?? false;
  }

  remember(account: string, ip: string): void {
    const list = (this.byAccount.get(account) ?? []).filter((known) => known !== ip);
    list.push(ip);
    while (list.length > this.bounds.perAccount) list.shift();
    // re-inserting moves the account to the end: Map order is "least recently used first"
    this.byAccount.delete(account);
    this.byAccount.set(account, list);
    while (this.byAccount.size > this.bounds.accounts) {
      const oldest = this.byAccount.keys().next().value;
      if (oldest === undefined) break;
      this.byAccount.delete(oldest);
    }
  }
}

export class LoginGuard {
  private readonly ip: FixedWindowLimiter;
  private readonly burst: FixedWindowLimiter;
  private readonly pair: FixedWindowLimiter;
  private readonly account: FixedWindowLimiter;
  private readonly gate: ConcurrencyGate;
  private readonly known: KnownAddresses;

  constructor(
    now: () => number = () => Date.now(),
    limits: typeof LOGIN_LIMITS = LOGIN_LIMITS,
    maxConcurrent: number = LOGIN_MAX_CONCURRENT_CHECKS,
    memory: { perAccount: number; accounts: number } = LOGIN_KNOWN_ADDRESSES,
  ) {
    this.ip = new FixedWindowLimiter(limits.perIp, now);
    this.burst = new FixedWindowLimiter(limits.perIpBurst, now);
    this.pair = new FixedWindowLimiter(limits.perAccountAndIp, now);
    this.account = new FixedWindowLimiter(limits.perAccount, now);
    this.gate = new ConcurrencyGate(maxConcurrent);
    this.known = new KnownAddresses(memory);
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

  /**
   * Second step, once the typed text (already lower-cased) and the account it names are known.
   * Throws RateLimitedError.
   */
  beginAttempt(ip: string, subject: AttemptSubject): LoginAttempt {
    const pairKey = `t:${subject.typed}|${ip}`;
    const accountKey = subject.userId ? `u:${subject.userId}` : `t:${subject.typed}`;
    const knownAddress = subject.userId !== null && this.known.has(accountKey, ip);
    const limits: [string, FixedWindowLimiter, string][] = [["pair", this.pair, pairKey]];
    if (!knownAddress) limits.push(["account", this.account, accountKey]);
    for (const [name, limiter, key] of limits) {
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
        this.account.refund(accountKey);
        this.ip.refund(`ip:${ip}`);
        if (subject.userId) this.known.remember(accountKey, ip);
      },
      done: release,
    };
  }
}
