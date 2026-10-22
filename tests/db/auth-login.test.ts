import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as loginRoute from "@/app/api/auth/login/route";
import { call, makeTeam, TEST_PASSWORD, uid } from "./helpers";

/**
 * The policy itself is covered, with a fake clock and no database, in tests/login-guard.test.ts.
 * These tests drive the real route: they prove the guard is wired in front of the password check
 * and that the HTTP contract (401 / 429 + Retry-After) holds. Only `Date` is faked, so bcrypt and
 * Prisma run normally.
 */
let ipCounter = 0;
/** A fresh client address per use so the limiter state of one test never leaks into another. */
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function login(email: string, password: string, ip: string) {
  return call(loginRoute.POST, {
    method: "POST",
    body: { email, password },
    headers: { "x-forwarded-for": ip },
  });
}

/** Moves the fake clock forward (keeps attempts from one address under the burst cap). */
function wait(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T09:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("login: brute-force protection (through the route)", () => {
  it("signs in with the right password", async () => {
    const { member } = await makeTeam();
    expect((await login(member.email, TEST_PASSWORD, freshIp())).status).toBe(200);
  });

  it("a wrong password is 401 eight times, then that address is locked out of the account with 429 + Retry-After", async () => {
    const { member } = await makeTeam();
    const ip = freshIp();
    for (let i = 0; i < 8; i++) {
      expect((await login(member.email, "wrong-pass-1", ip)).status).toBe(401);
      wait(2_000);
    }
    const blocked = await login(member.email, "wrong-pass-1", ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // even the CORRECT password is refused from that address while the lock lasts
    expect((await login(member.email, TEST_PASSWORD, ip)).status).toBe(429);
  });

  it("somebody hammering an account from their own address does not lock the real user out", async () => {
    const { member } = await makeTeam();
    const attacker = freshIp();
    for (let i = 0; i < 8; i++) {
      await login(member.email, "wrong-pass-2", attacker);
      wait(2_000);
    }
    expect((await login(member.email, "wrong-pass-2", attacker)).status).toBe(429);
    // the user, from another address with the right password, gets in
    expect((await login(member.email, TEST_PASSWORD, freshIp())).status).toBe(200);
  });

  it("guessing spread over many addresses still hits an account-wide cap", async () => {
    const { member } = await makeTeam();
    for (let i = 0; i < 30; i++) {
      expect((await login(member.email, "wrong-pass-3", freshIp())).status).toBe(401);
    }
    expect((await login(member.email, "wrong-pass-3", freshIp())).status).toBe(429);
  });

  it("a successful sign-in clears the failure counters", async () => {
    const { member } = await makeTeam();
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      await login(member.email, "wrong-pass-4", ip);
      wait(2_000);
    }
    expect((await login(member.email, TEST_PASSWORD, ip)).status).toBe(200);
    wait(2_000);
    for (let i = 0; i < 5; i++) {
      expect((await login(member.email, "wrong-pass-4", ip)).status).toBe(401);
      wait(2_000);
    }
  });

  it("unknown e-mail addresses are limited too (no free enumeration)", async () => {
    const email = `nobody-${uid()}@test.local`;
    const ip = freshIp();
    for (let i = 0; i < 8; i++) {
      expect((await login(email, "whatever-1", ip)).status).toBe(401);
      wait(2_000);
    }
    expect((await login(email, "whatever-1", ip)).status).toBe(429);
  });

  it("a burst from one address is cut off quickly (a password check costs CPU)", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await login(`nobody-${uid()}@test.local`, "whatever-1", ip)).status);
    }
    expect(statuses.slice(0, 6)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(statuses.slice(6)).toEqual([429, 429]);
  });

  it("forty simultaneous guesses for one account cannot all be checked", async () => {
    const { member } = await makeTeam();
    const results = await Promise.all(
      Array.from({ length: 40 }, () => login(member.email, "wrong-pass-5", freshIp())),
    );
    const unauthorized = results.filter((r) => r.status === 401).length;
    const limited = results.filter((r) => r.status === 429).length;
    expect(unauthorized + limited).toBe(40);
    // at most 3 checks run at once and the account-wide cap is 30: nothing like 40 guesses get through
    expect(unauthorized).toBeLessThanOrEqual(30);
    expect(limited).toBeGreaterThanOrEqual(10);
  });
});
