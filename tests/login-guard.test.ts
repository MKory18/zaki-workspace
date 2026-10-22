import { describe, expect, it } from "vitest";
import * as guardModule from "../src/server/login-guard";
import { LoginGuard } from "../src/server/login-guard";
import * as rateLimit from "../src/server/rate-limit";
import { ConcurrencyGate, LOGIN_LIMITS, RateLimitedError } from "../src/server/rate-limit";

/** Who an attempt is about: what was typed (lower-cased) and the account it names, or null. */
interface Subject {
  typed: string;
  userId: string | null;
}
const nobody = (typed: string): Subject => ({ typed, userId: null });
const person = (typed: string, userId: string): Subject => ({ typed, userId });

const MEMORY = (rateLimit as Record<string, unknown>)["LOGIN_KNOWN_ADDRESSES"] ?? { perAccount: 20, accounts: 10_000 };

/** A guard with a clock the test controls and plenty of password-check slots unless a test says otherwise. */
function makeGuard(maxConcurrent = 1000, memory: unknown = MEMORY) {
  let t = 1_000_000_000;
  const Guard = guardModule.LoginGuard as unknown as new (...args: unknown[]) => LoginGuard;
  const guard = new Guard(() => t, LOGIN_LIMITS, maxConcurrent, memory);
  return {
    guard,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

type Begin = (ip: string, subject: Subject) => { success(): void; done(): void };
const begin = (guard: LoginGuard, ip: string, subject: Subject) => (guard.beginAttempt as unknown as Begin).call(guard, ip, subject);

/** One failed attempt: admit, count, give the slot back (what the route does on a wrong password). */
function fail(guard: LoginGuard, ip: string, subject: Subject): void {
  guard.admitAddress(ip);
  begin(guard, ip, subject).done();
}

/** One successful sign-in. */
function succeed(guard: LoginGuard, ip: string, subject: Subject): void {
  guard.admitAddress(ip);
  const attempt = begin(guard, ip, subject);
  attempt.success();
  attempt.done();
}

/** Would this attempt be refused right now? (When it is let through, it counts as one failed attempt.) */
function locked(guard: LoginGuard, ip: string, subject: Subject): boolean {
  try {
    begin(guard, ip, subject).done();
    return false;
  } catch (err) {
    if (err instanceof RateLimitedError) return true;
    throw err;
  }
}

describe("LoginGuard: one account from one address", () => {
  it("allows 8 failures, then locks that (typed text, address) pair", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 8; i++) {
      fail(guard, "1.1.1.1", person("a@x.test", "u-a"));
      advance(2_000); // stay under the burst cap
    }
    guard.admitAddress("1.1.1.1");
    expect(() => begin(guard, "1.1.1.1", person("a@x.test", "u-a"))).toThrow(RateLimitedError);
  });

  it("does NOT lock the real user out when somebody else hammers the account from another address", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 8; i++) {
      fail(guard, "6.6.6.6", person("boss@x.test", "u-boss"));
      advance(2_000);
    }
    // the attacker is locked...
    guard.admitAddress("6.6.6.6");
    expect(() => begin(guard, "6.6.6.6", person("boss@x.test", "u-boss"))).toThrow(RateLimitedError);
    // ...but the owner signing in from his own address is not
    guard.admitAddress("9.9.9.9");
    expect(() => begin(guard, "9.9.9.9", person("boss@x.test", "u-boss")).done()).not.toThrow();
  });

  it("a successful sign-in clears that pair's failures", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 5; i++) {
      fail(guard, "1.1.1.1", person("a@x.test", "u-a"));
      advance(2_000);
    }
    succeed(guard, "1.1.1.1", person("a@x.test", "u-a"));
    advance(2_000);
    for (let i = 0; i < 5; i++) {
      expect(() => fail(guard, "1.1.1.1", person("a@x.test", "u-a"))).not.toThrow();
      advance(2_000);
    }
  });

  it("the lock ends when the window ends", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 8; i++) {
      fail(guard, "1.1.1.1", person("a@x.test", "u-a"));
      advance(2_000);
    }
    guard.admitAddress("1.1.1.1");
    expect(() => begin(guard, "1.1.1.1", person("a@x.test", "u-a"))).toThrow(RateLimitedError);
    advance(LOGIN_LIMITS.perAccountAndIp.windowMs);
    guard.admitAddress("1.1.1.1");
    expect(() => begin(guard, "1.1.1.1", person("a@x.test", "u-a")).done()).not.toThrow();
  });
});

describe("LoginGuard: which counter an attempt counts against", () => {
  it("typed text that names nobody never counts against a real account, even when it spells the account's id", () => {
    const { guard } = makeGuard();
    for (let i = 0; i < 40; i++) {
      try {
        fail(guard, `10.1.0.${i}`, nobody("u-victim"));
      } catch {
        /* the typed text gets locked: that is its own business */
      }
    }
    expect(locked(guard, "10.1.1.1", person("victim@x.test", "u-victim"))).toBe(false);
  });

  it("the (typed text, address) lock follows what was TYPED: a locked username says nothing about an e-mail", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 8; i++) {
      fail(guard, "1.1.1.1", person("ali", "u-ali"));
      advance(2_000);
    }
    expect(locked(guard, "1.1.1.1", person("ali", "u-ali"))).toBe(true);
    // the same person's e-mail, and somebody else's, answer alike from that address
    expect(locked(guard, "1.1.1.1", person("ali@x.test", "u-ali"))).toBe(false);
    expect(locked(guard, "1.1.1.1", person("omar@x.test", "u-omar"))).toBe(false);
  });

  it("the account-wide cap follows the ACCOUNT: alternating username and e-mail does not double it", () => {
    const { guard } = makeGuard();
    for (let i = 0; i < LOGIN_LIMITS.perAccount.limit; i++) {
      fail(guard, `10.2.0.${i}`, person(i % 2 === 0 ? "ali" : "ali@x.test", "u-ali"));
    }
    expect(locked(guard, "10.2.1.1", person("ali", "u-ali"))).toBe(true);
    expect(locked(guard, "10.2.1.2", person("ali@x.test", "u-ali"))).toBe(true);
  });

  it("a correct password is not a failure: forty sign-ins of one account from new addresses never lock it", () => {
    const { guard } = makeGuard();
    for (let i = 0; i < 40; i++) {
      expect(() => succeed(guard, `10.3.0.${i}`, person("ali", "u-ali")), String(i)).not.toThrow();
    }
  });
});

describe("LoginGuard: known-good addresses (the cap cannot be turned against the real person)", () => {
  it("an address the person signed in from before is not locked by the account-wide cap; strangers are", () => {
    const { guard, advance } = makeGuard();
    succeed(guard, "8.8.8.8", person("boss@x.test", "u-boss")); // his office
    for (let i = 0; i < LOGIN_LIMITS.perAccount.limit; i++) fail(guard, `10.4.0.${i}`, person("boss@x.test", "u-boss"));
    expect(locked(guard, "10.4.1.1", person("boss@x.test", "u-boss"))).toBe(true);
    expect(locked(guard, "8.8.8.8", person("boss@x.test", "u-boss"))).toBe(false); // (one failure)
    // the office still has its own (typed text, address) limit: 7 more failures make 8
    for (let i = 0; i < 7; i++) {
      fail(guard, "8.8.8.8", person("boss@x.test", "u-boss"));
      advance(2_000);
    }
    expect(locked(guard, "8.8.8.8", person("boss@x.test", "u-boss"))).toBe(true);
  });

  it("an address is known for the account that signed in from it, not for others", () => {
    const { guard } = makeGuard();
    succeed(guard, "8.8.8.8", person("boss@x.test", "u-boss"));
    for (let i = 0; i < LOGIN_LIMITS.perAccount.limit; i++) fail(guard, `10.5.0.${i}`, person("omar", "u-omar"));
    expect(locked(guard, "8.8.8.8", person("omar", "u-omar"))).toBe(true);
  });

  it("the memory is bounded: the oldest address of an account, and the oldest account, are forgotten", () => {
    const { guard } = makeGuard(1000, { perAccount: 2, accounts: 2 });
    succeed(guard, "8.8.8.1", person("a", "u-a"));
    succeed(guard, "8.8.8.2", person("a", "u-a"));
    succeed(guard, "8.8.8.3", person("a", "u-a")); // pushes 8.8.8.1 out
    succeed(guard, "8.8.8.9", person("b", "u-b"));
    succeed(guard, "8.8.8.9", person("c", "u-c")); // pushes account a out
    ["u-a", "u-b", "u-c"].forEach((id, k) => {
      for (let i = 0; i < LOGIN_LIMITS.perAccount.limit; i++) fail(guard, `10.6.${k}.${i}`, person(id, id));
    });
    expect(locked(guard, "8.8.8.3", person("a", "u-a")), "account a was forgotten").toBe(true);
    expect(locked(guard, "8.8.8.9", person("b", "u-b"))).toBe(false);
    expect(locked(guard, "8.8.8.9", person("c", "u-c"))).toBe(false);

    const { guard: g2 } = makeGuard(1000, { perAccount: 2, accounts: 10 });
    succeed(g2, "8.8.8.1", person("a", "u-a"));
    succeed(g2, "8.8.8.2", person("a", "u-a"));
    succeed(g2, "8.8.8.3", person("a", "u-a"));
    for (let i = 0; i < LOGIN_LIMITS.perAccount.limit; i++) fail(g2, `10.7.0.${i}`, person("a", "u-a"));
    expect(locked(g2, "8.8.8.1", person("a", "u-a")), "the oldest address was forgotten").toBe(true);
    expect(locked(g2, "8.8.8.3", person("a", "u-a"))).toBe(false);
  });
});

describe("LoginGuard: one address", () => {
  it("caps the burst: 7 attempts within 10 seconds, successful ones included", () => {
    const { guard } = makeGuard();
    for (let i = 0; i < 6; i++) succeed(guard, "2.2.2.2", person(`p${i}`, `u-p${i}`));
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

  it("caps the FAILURES from the address (30 per window) however many accounts it tries", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 30; i++) {
      guard.admitAddress("3.3.3.3");
      advance(2_000);
    }
    expect(() => guard.admitAddress("3.3.3.3")).toThrow(RateLimitedError);
    expect(() => guard.admitAddress("3.3.3.4")).not.toThrow(); // another address is unaffected
  });

  it("an office behind one address: thirty-one colleagues who type the right password all get in", () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 31; i++) {
      expect(() => succeed(guard, "4.4.4.4", person(`colleague${i}`, `u-c${i}`)), String(i)).not.toThrow();
      advance(2_000);
    }
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
        begin(guard, `172.16.0.${i}`, person("victim@x.test", "u-victim")); // never done(): still "verifying"
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
    const a = begin(guard, "1.1.1.1", nobody("a@x.test"));
    begin(guard, "1.1.1.2", nobody("b@x.test"));
    begin(guard, "1.1.1.3", nobody("c@x.test"));
    expect(() => begin(guard, "1.1.1.4", nobody("d@x.test"))).toThrow(RateLimitedError);
    a.done();
    expect(() => begin(guard, "1.1.1.4", nobody("d@x.test"))).not.toThrow();
  });

  it("an attempt refused because the server is busy does not eat the account's failure budget", () => {
    const { guard, advance } = makeGuard(1);
    const slot = begin(guard, "1.1.1.1", nobody("a@x.test")); // takes the only slot
    for (let i = 0; i < 20; i++) expect(() => begin(guard, "1.1.1.2", person("z@x.test", "u-z"))).toThrow(RateLimitedError);
    slot.done();
    // none of those 20 refusals counted: z still has its full 8 attempts, and the 9th is the real lock
    for (let i = 0; i < 8; i++) {
      expect(() => begin(guard, "1.1.1.2", person("z@x.test", "u-z")).done()).not.toThrow();
      advance(2_000);
    }
    expect(() => begin(guard, "1.1.1.2", person("z@x.test", "u-z"))).toThrow(RateLimitedError);
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
