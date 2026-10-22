import { describe, expect, it } from "vitest";
import { LoginGuard } from "../src/server/login-guard";
import { ConcurrencyGate, LOGIN_LIMITS, RateLimitedError } from "../src/server/rate-limit";

/** A guard with a clock the test controls and plenty of password-check slots unless a test says otherwise. */
function makeGuard(maxConcurrent = 1000) {
  let t = 1_000_000_000;
  const guard = new LoginGuard(() => t, LOGIN_LIMITS, maxConcurrent);
  return {
    guard,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** One failed attempt: admit, count, give the slot back (what the route does on a wrong password). */
function fail(guard: LoginGuard, ip: string, email: string): void {
  guard.admitAddress(ip);
  guard.beginAttempt(ip, email).done();
}

describe("LoginGuard: one account from one address", () => {
  it("allows 8 failures, then locks that (account, address) pair", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 8; i++) {
      fail(guard, "1.1.1.1", "a@x.test");
      advance(2_000); // stay under the burst cap
    }
    guard.admitAddress("1.1.1.1");
    expect(() => guard.beginAttempt("1.1.1.1", "a@x.test")).toThrow(RateLimitedError);
  });

  it("does NOT lock the real user out when somebody else hammers the account from another address", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 8; i++) {
      fail(guard, "6.6.6.6", "boss@x.test");
      advance(2_000);
    }
    // the attacker is locked...
    guard.admitAddress("6.6.6.6");
    expect(() => guard.beginAttempt("6.6.6.6", "boss@x.test")).toThrow(RateLimitedError);
    // ...but the owner signing in from his own address is not
    guard.admitAddress("9.9.9.9");
    expect(() => guard.beginAttempt("9.9.9.9", "boss@x.test").done()).not.toThrow();
  });

  it("a successful sign-in clears the failure counters", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 5; i++) {
      fail(guard, "1.1.1.1", "a@x.test");
      advance(2_000);
    }
    guard.admitAddress("1.1.1.1");
    const ok = guard.beginAttempt("1.1.1.1", "a@x.test");
    ok.success();
    ok.done();
    advance(2_000);
    for (let i = 0; i < 5; i++) {
      expect(() => fail(guard, "1.1.1.1", "a@x.test")).not.toThrow();
      advance(2_000);
    }
  });

  it("the lock ends when the window ends", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 8; i++) {
      fail(guard, "1.1.1.1", "a@x.test");
      advance(2_000);
    }
    guard.admitAddress("1.1.1.1");
    expect(() => guard.beginAttempt("1.1.1.1", "a@x.test")).toThrow(RateLimitedError);
    advance(LOGIN_LIMITS.perAccountAndIp.windowMs);
    guard.admitAddress("1.1.1.1");
    expect(() => guard.beginAttempt("1.1.1.1", "a@x.test").done()).not.toThrow();
  });
});

describe("LoginGuard: guessing spread over many addresses", () => {
  it("caps the account as a whole (30 failures from 30 different addresses, then locked)", () => {
    const { guard } = makeGuard();
    for (let i = 0; i < LOGIN_LIMITS.perAccount.limit; i++) fail(guard, `10.0.0.${i}`, "boss@x.test");
    guard.admitAddress("10.0.1.1");
    expect(() => guard.beginAttempt("10.0.1.1", "boss@x.test")).toThrow(RateLimitedError);
  });
});

describe("LoginGuard: one address", () => {
  it("caps the burst: 7 attempts within 10 seconds", () => {
    const { guard } = makeGuard();
    for (let i = 0; i < 6; i++) guard.admitAddress("2.2.2.2");
    const err = (() => {
      try {
        guard.admitAddress("2.2.2.2");
      } catch (e) {
        return e as RateLimitedError;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err!.retryAfterSec).toBeLessThanOrEqual(10);
  });

  it("caps all attempts from the address (30 per window) however many accounts it tries", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 30; i++) {
      guard.admitAddress("3.3.3.3");
      advance(2_000);
    }
    expect(() => guard.admitAddress("3.3.3.3")).toThrow(RateLimitedError);
    expect(() => guard.admitAddress("3.3.3.4")).not.toThrow(); // another address is unaffected
  });
});

describe("LoginGuard: counting is atomic (no check-then-act race)", () => {
  it("40 attempts that are all in flight at once cannot all slip past the account cap", () => {
    const { guard } = makeGuard();
    let admitted = 0;
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      try {
        guard.admitAddress(`172.16.0.${i}`);
        guard.beginAttempt(`172.16.0.${i}`, "victim@x.test"); // never done(): still "verifying"
        admitted += 1;
      } catch {
        refused += 1;
      }
    }
    expect(admitted).toBe(LOGIN_LIMITS.perAccount.limit);
    expect(refused).toBe(40 - LOGIN_LIMITS.perAccount.limit);
  });
});

describe("LoginGuard: password-check slots", () => {
  it("at most 3 checks run at once; a 4th is refused until one finishes", () => {
    const { guard } = makeGuard(3);
    const a = guard.beginAttempt("1.1.1.1", "a@x.test");
    guard.beginAttempt("1.1.1.2", "b@x.test");
    guard.beginAttempt("1.1.1.3", "c@x.test");
    expect(() => guard.beginAttempt("1.1.1.4", "d@x.test")).toThrow(RateLimitedError);
    a.done();
    expect(() => guard.beginAttempt("1.1.1.4", "d@x.test")).not.toThrow();
  });

  it("an attempt refused because the server is busy does not eat the account's failure budget", () => {
    const { guard, advance } = makeGuard(1);
    const slot = guard.beginAttempt("1.1.1.1", "a@x.test"); // takes the only slot
    for (let i = 0; i < 20; i++) expect(() => guard.beginAttempt("1.1.1.2", "z@x.test")).toThrow(RateLimitedError);
    slot.done();
    // none of those 20 refusals counted: z still has its full 8 attempts, and the 9th is the real lock
    for (let i = 0; i < 8; i++) {
      expect(() => guard.beginAttempt("1.1.1.2", "z@x.test").done()).not.toThrow();
      advance(2_000);
    }
    expect(() => guard.beginAttempt("1.1.1.2", "z@x.test")).toThrow(RateLimitedError);
  });
});

describe("ConcurrencyGate", () => {
  it("release is idempotent (a double release never frees a slot that is still in use)", () => {
    const gate = new ConcurrencyGate(1);
    const release = gate.tryAcquire()!;
    release();
    release();
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
  });
});
