import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as loginRoute from "@/app/api/auth/login/route";
import { call, db, logout, makeTeam, makeUser, TEST_PASSWORD, uid } from "./helpers";
import { sessionClaims, sessionCookie, setMemberStatus } from "./login-helpers";

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

  it("the lock follows the identifier as typed: a username is limited exactly like an e-mail", async () => {
    const username = `lock-${uid()}`;
    const { org } = await makeTeam();
    await makeUser({ orgId: org.id, username });
    const ip = freshIp();
    for (let i = 0; i < 8; i++) {
      expect((await signIn({ identifier: username.toUpperCase(), password: "wrong-pass-6" }, ip)).status).toBe(401);
      wait(2_000);
    }
    expect((await signIn({ identifier: username, password: TEST_PASSWORD }, ip)).status).toBe(429);
  });
});

describe("login: one account-wide cap per account", () => {
  it("alternating between a person's username and e-mail does not double the account-wide cap", async () => {
    const username = `lock2-${uid()}`;
    const { org } = await makeTeam();
    const person = await makeUser({ orgId: org.id, username });
    for (let i = 0; i < 30; i++) {
      const identifier = i % 2 === 0 ? username : person.email;
      expect((await signIn({ identifier, password: "wrong-pass-7" }, freshIp())).status).toBe(401);
    }
    // thirty wrong guesses in total, whichever way they were typed: a stranger's address is now
    // refused for both spellings (the (typed text, address) lock is separate: see login-lockout)
    expect((await signIn({ identifier: username, password: TEST_PASSWORD }, freshIp())).status).toBe(429);
    expect((await signIn({ identifier: person.email, password: TEST_PASSWORD }, freshIp())).status).toBe(429);
  });
});

/** The Phase 1 body: `identifier` is a username or an e-mail address. */
function signIn(body: Record<string, unknown>, ip: string) {
  return call(loginRoute.POST, { method: "POST", body, headers: { "x-forwarded-for": ip } });
}

describe("login: username or e-mail", () => {
  beforeEach(() => logout());

  it("signs in with the username, in any letter case", async () => {
    const username = `ali-${uid()}`;
    const { org } = await makeTeam();
    const user = await makeUser({ orgId: org.id, username });
    for (const typed of [username, username.toUpperCase(), `  ${username}  `]) {
      logout();
      const res = await signIn({ identifier: typed, password: TEST_PASSWORD }, freshIp());
      expect(res.status, typed).toBe(200);
      expect((await sessionClaims())?.userId).toBe(user.id);
    }
  });

  it("signs in with the e-mail address as the identifier, in any letter case", async () => {
    const { member } = await makeTeam();
    const res = await signIn({ identifier: member.email.toUpperCase(), password: TEST_PASSWORD }, freshIp());
    expect(res.status).toBe(200);
    expect((await sessionClaims())?.userId).toBe(member.id);
  });

  it("still accepts the old { email, password } body", async () => {
    const { member } = await makeTeam();
    const res = await login(member.email, TEST_PASSWORD, freshIp());
    expect(res.status).toBe(200);
    expect((await sessionClaims())?.userId).toBe(member.id);
  });

  it("an unknown identifier and a wrong password get the same generic 401", async () => {
    const { member } = await makeTeam();
    const unknown = await signIn({ identifier: `nobody-${uid()}`, password: TEST_PASSWORD }, freshIp());
    const wrong = await signIn({ identifier: member.email, password: "Wrong-pass-7" }, freshIp());
    for (const res of [unknown, wrong]) {
      expect(res.status).toBe(401);
      expect(res.json).toMatchObject({ error: "auth.required", message: "invalid_credentials" });
    }
    expect(sessionCookie()).toBeUndefined();
  });
});

describe("login: where the client goes next", () => {
  beforeEach(() => logout());

  it("a fully onboarded person goes to the app", async () => {
    const { member } = await makeTeam();
    const res = await signIn({ identifier: member.email, password: TEST_PASSWORD }, freshIp());
    expect(res.json).toEqual({ ok: true, next: "/" });
  });

  it("a person with a temporary password goes to /onboarding, and the cookie says so", async () => {
    const { member } = await makeTeam();
    await db.user.update({ where: { id: member.id }, data: { mustChangePassword: true } });
    const res = await signIn({ identifier: member.email, password: TEST_PASSWORD }, freshIp());
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, next: "/onboarding" });
    expect(await sessionClaims()).toMatchObject({ userId: member.id, mcp: true });
  });

  it("a person who has not accepted the current notice goes to /onboarding", async () => {
    const { org, member } = await makeTeam();
    // the owner raised the notice version after this person accepted version 1
    await db.organization.update({ where: { id: org.id }, data: { settings: { transparencyVersion: 2 } } });
    const res = await signIn({ identifier: member.email, password: TEST_PASSWORD }, freshIp());
    expect(res.json).toEqual({ ok: true, next: "/onboarding" });
    expect(await sessionClaims()).toMatchObject({ userId: member.id, tp: true });
  });
});

describe("login: suspended and offboarded people", () => {
  beforeEach(() => logout());

  it("the right password of a suspended person gets a clear 403 and NO cookie", async () => {
    const { member } = await makeTeam();
    await setMemberStatus(member.id, "SUSPENDED");
    const res = await signIn({ identifier: member.email, password: TEST_PASSWORD }, freshIp());
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ error: "forbidden", message: "auth.account_suspended" });
    expect(sessionCookie()).toBeUndefined();
  });

  it("an offboarded person is refused the same way", async () => {
    const { member } = await makeTeam();
    await setMemberStatus(member.id, "OFFBOARDED");
    const res = await signIn({ identifier: member.email, password: TEST_PASSWORD }, freshIp());
    expect(res.status).toBe(403);
    expect(res.json?.message).toBe("auth.account_suspended");
    expect(sessionCookie()).toBeUndefined();
  });

  it("a WRONG password for a suspended person is the generic 401 (the status does not leak)", async () => {
    const { member } = await makeTeam();
    await setMemberStatus(member.id, "SUSPENDED");
    const res = await signIn({ identifier: member.email, password: "Wrong-pass-8" }, freshIp());
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ error: "auth.required", message: "invalid_credentials" });
  });

  it("a person still active in another organization signs in", async () => {
    const a = await makeTeam();
    const b = await makeTeam();
    await db.organizationMember.create({ data: { organizationId: b.org.id, userId: a.member.id, role: "MEMBER" } });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: a.org.id, userId: a.member.id } },
      data: { status: "SUSPENDED" },
    });
    const res = await signIn({ identifier: a.member.email, password: TEST_PASSWORD }, freshIp());
    expect(res.status).toBe(200);
  });
});

describe("login: what is recorded", () => {
  beforeEach(() => logout());

  it("lastLoginAt is written on success only", async () => {
    const { member } = await makeTeam();
    const lastLogin = async () =>
      (await db.user.findUniqueOrThrow({ where: { id: member.id }, select: { lastLoginAt: true } })).lastLoginAt;

    await signIn({ identifier: member.email, password: "Wrong-pass-9" }, freshIp());
    expect(await lastLogin()).toBeNull();

    await setMemberStatus(member.id, "SUSPENDED");
    await signIn({ identifier: member.email, password: TEST_PASSWORD }, freshIp());
    expect(await lastLogin()).toBeNull();

    await setMemberStatus(member.id, "ACTIVE");
    expect((await signIn({ identifier: member.email, password: TEST_PASSWORD }, freshIp())).status).toBe(200);
    expect((await lastLogin())?.toISOString()).toBe(new Date().toISOString());
  });

  it("audits the sign-in, and never writes a password or a mistyped identifier", async () => {
    const { org, member } = await makeTeam();
    const typo = `typo-${uid()}`;
    // (audit rows get their time from the database engine, not from the faked Date: select by id)
    const before = new Set((await db.auditLog.findMany({ select: { id: true } })).map((r) => r.id));
    await signIn({ identifier: typo, password: "Secret-typed-1" }, freshIp());
    await signIn({ identifier: member.email, password: "Secret-typed-2" }, freshIp());
    await signIn({ identifier: member.email, password: TEST_PASSWORD }, freshIp());

    const rows = (await db.auditLog.findMany({ where: { action: { startsWith: "auth.login" } } })).filter(
      (r) => !before.has(r.id),
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("Secret-typed");
    expect(text).not.toContain(TEST_PASSWORD);
    expect(text).not.toContain(typo);
    expect(rows.find((r) => r.action === "auth.login" && r.actorId === member.id)).toMatchObject({ orgId: org.id });
    // a failure against a real account is attributable to that account
    expect(rows.some((r) => r.action === "auth.login_failed" && r.target === member.id)).toBe(true);
  });
});
