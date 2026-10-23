import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as loginRoute from "@/app/api/auth/login/route";
import { call, logout, makeTeam, makeUser, TEST_PASSWORD, uid } from "./helpers";

/**
 * The sign-in lock-out must never be a tool against the real person (found by independent review A).
 * The policy itself is tested with a fake clock in tests/login-guard.test.ts; these drive the real
 * route:
 *  - the account-wide cap (30 failures / 10 min, all addresses) does not lock a person out of an
 *    address they signed in from before;
 *  - typed text that names nobody has its own counter: typing somebody's internal id (shown in
 *    links and API answers) does not count against their account;
 *  - the per-address cap counts failures only: an office behind one address signs everybody in;
 *  - the (typed text, address) lock does not reveal which e-mail belongs to a locked username.
 */

let n = 0;
/** A fresh client address per use (TEST-NET-3, its own range), so tests never share limiter state. */
function addr(): string {
  n += 1;
  return `203.0.113.${n}`;
}

function signIn(identifier: string, password: string, from: string) {
  return call(loginRoute.POST, { method: "POST", body: { identifier, password }, headers: { "x-forwarded-for": from } });
}

/** Moves the fake clock forward (keeps one address under its 6-per-10-seconds burst cap). */
function wait(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

/** `total` wrong guesses for `identifier`, spread over as many addresses as the per-address caps need. */
async function sprayWrongGuesses(identifier: string, total: number): Promise<void> {
  let sent = 0;
  while (sent < total) {
    const from = addr();
    for (let i = 0; i < 8 && sent < total; i++, sent++) {
      expect((await signIn(identifier, "Wrong-guess-1", from)).status).toBe(401);
      wait(2_000);
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T09:00:00Z"));
  logout();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("login lock-out: it cannot be turned against the real person", () => {
  it("thirty wrong guesses from four other addresses do not lock the owner out of his own office address", async () => {
    const { owner } = await makeTeam();
    const office = addr();
    expect((await signIn(owner.email, TEST_PASSWORD, office)).status).toBe(200); // his usual address
    logout();

    await sprayWrongGuesses(owner.email, 30); // 8 + 8 + 8 + 6, every address under its own caps

    // a stranger's address is locked out of the account now...
    expect((await signIn(owner.email, TEST_PASSWORD, addr())).status).toBe(429);
    // ...the owner's own address is not
    const res = await signIn(owner.email, TEST_PASSWORD, office);
    expect(res.status, "the owner is locked out of his own account, from his own address").toBe(200);
  });

  it("an identifier that names nobody never counts against a real account (typing somebody's internal id)", async () => {
    const { member } = await makeTeam();
    // member.id is nobody's username or e-mail: the attempts count against that typed text only
    await sprayWrongGuesses(member.id, 30);

    const res = await signIn(member.email, TEST_PASSWORD, addr());
    expect(res.status, "the victim is locked out by guesses aimed at an identifier that does not exist").toBe(200);
  });

  it("an office behind one address: thirty-one colleagues who type the RIGHT password within ten minutes all get in", async () => {
    // Deploy day: "everybody signs in once more". The per-address cap (30 / 10 min) counts failures.
    const { org } = await makeTeam();
    const office = addr();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const colleague = await makeUser({ orgId: org.id });
      statuses.push((await signIn(colleague.email, TEST_PASSWORD, office)).status);
      logout();
      wait(2_000); // well under the burst cap (6 per 10 s)
    }
    expect(statuses.filter((s) => s !== 200), "correct sign-ins refused for sharing an address").toEqual([]);
  });

  it("the lock does not tell a stranger which e-mail address belongs to a username", async () => {
    const { org } = await makeTeam();
    const username = `ali-${uid()}`;
    const person = await makeUser({ orgId: org.id, username });
    const somebodyElse = await makeUser({ orgId: org.id });
    const probe = addr();
    for (let i = 0; i < 8; i++) {
      expect((await signIn(username, "Wrong-guess-2", probe)).status).toBe(401);
      wait(2_000);
    }
    expect((await signIn(username, "Wrong-guess-2", probe)).status).toBe(429); // the username IS locked here
    wait(2_000);
    const candidateThatMatches = await signIn(person.email, "Wrong-guess-2", probe);
    wait(2_000);
    const candidateThatDoesNot = await signIn(somebodyElse.email, "Wrong-guess-2", probe);
    expect(
      candidateThatMatches.status,
      "429 for the e-mail of the locked username, 401 for any other: the username and e-mail are linked",
    ).toBe(candidateThatDoesNot.status);
    expect(candidateThatMatches.status).toBe(401);
  });
});
