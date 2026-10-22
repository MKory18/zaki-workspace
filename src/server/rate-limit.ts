/**
 * Small in-memory fixed-window rate limiter (login / register brute-force guard).
 *
 * State lives in this process only. That is correct for the single Docker
 * container this app runs as; if it is ever scaled to several replicas the
 * counters must move to the database.
 */

export interface LimiterOptions {
  /** Events allowed per window. */
  limit: number;
  windowMs: number;
}

export interface LimiterState {
  ok: boolean;
  /** Seconds until the key is allowed again (0 when ok). */
  retryAfterSec: number;
}

/** Thrown by routes; `withApi` turns it into 429 + Retry-After. */
export class RateLimitedError extends Error {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number, message = "auth.too_many_attempts") {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfterSec = Math.max(1, Math.ceil(retryAfterSec));
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly opts: LimiterOptions,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private live(key: string): Bucket | undefined {
    const b = this.buckets.get(key);
    if (!b) return undefined;
    if (b.resetAt <= this.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return b;
  }

  /** May another event for this key proceed? Does not count anything. */
  check(key: string): LimiterState {
    const b = this.live(key);
    if (!b || b.count < this.opts.limit) return { ok: true, retryAfterSec: 0 };
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - this.now()) / 1000) };
  }

  /** Count one event for this key. */
  hit(key: string): void {
    const t = this.now();
    const b = this.live(key);
    if (b) {
      b.count += 1;
      return;
    }
    if (this.buckets.size >= 10_000) this.prune();
    this.buckets.set(key, { count: 1, resetAt: t + this.opts.windowMs });
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private prune(): void {
    const t = this.now();
    for (const [key, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(key);
    // Still huge (an attack with unique keys): drop the oldest half rather than grow without bound.
    if (this.buckets.size >= 10_000) {
      let drop = Math.floor(this.buckets.size / 2);
      for (const key of this.buckets.keys()) {
        if (drop-- <= 0) break;
        this.buckets.delete(key);
      }
    }
  }
}

/** The limits themselves, in one place so tests and docs can read them. */
export const LOGIN_LIMITS = {
  /**
   * Failed attempts for ONE account from ONE address. This is the lock that stops a person
   * guessing; it follows the pair, so someone hammering an account from their own address
   * cannot lock the real user out when that user signs in from somewhere else.
   */
  perAccountAndIp: { limit: 8, windowMs: 10 * 60_000 },
  /** Failed attempts for one account from ALL addresses together: caps guessing spread over many addresses. */
  perAccount: { limit: 30, windowMs: 10 * 60_000 },
  /** All attempts from one address. Generous: an office shares one address. */
  perIp: { limit: 30, windowMs: 10 * 60_000 },
  /** A short burst from one address (a password check costs ~0.3 s of CPU). */
  perIpBurst: { limit: 6, windowMs: 10_000 },
} as const;

/** Password checks running at the same time. bcrypt is CPU-bound; more only starves the server. */
export const LOGIN_MAX_CONCURRENT_CHECKS = 3;

/** A counting gate: at most `max` holders at once; `tryAcquire` never waits. */
export class ConcurrencyGate {
  private active = 0;
  constructor(private readonly max: number) {}

  /** A release function, or null when the gate is full. The release is idempotent. */
  tryAcquire(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}

export const REGISTER_LIMIT: LimiterOptions = { limit: 10, windowMs: 60 * 60_000 };

/**
 * The caller's address as seen by the trusted reverse proxy.
 * `TRUSTED_PROXY_HOPS` (default 1) is how many proxies sit in front of the
 * app; the address added by the proxy closest to the app is the one counted
 * from the right of X-Forwarded-For, so a client cannot choose it by sending
 * its own header.
 */
export function clientIp(req: Request): string {
  const hops = Math.max(1, Number(process.env["TRUSTED_PROXY_HOPS"] ?? 1) || 1);
  const forwarded = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (forwarded.length > 0) return forwarded[Math.max(0, forwarded.length - hops)] ?? forwarded[0]!;
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
