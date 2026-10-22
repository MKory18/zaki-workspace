import { describe, expect, it } from "vitest";
import * as loginRoute from "@/app/api/auth/login/route";
import { call, makeTeam, TEST_PASSWORD, uid } from "./helpers";

let ipCounter = 0;
/** A fresh client address per test so the limiter state of one test never leaks into another. */
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

describe("login: brute-force protection", () => {
  it("signs in with the right password", async () => {
    const { member } = await makeTeam();
    const res = await login(member.email, TEST_PASSWORD, freshIp());
    expect(res.status).toBe(200);
  });

  it("a wrong password is 401 at first, then the account is locked out with 429 + Retry-After", async () => {
    const { member } = await makeTeam();
    const ip = freshIp();
    for (let i = 0; i < 8; i++) {
      expect((await login(member.email, "wrong-pass-1", ip)).status).toBe(401);
    }
    const blocked = await login(member.email, "wrong-pass-1", ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // even the CORRECT password is refused while the lock-out lasts
    expect((await login(member.email, TEST_PASSWORD, ip)).status).toBe(429);
  });

  it("the lock-out follows the account, not the address (guessing from many IPs does not help)", async () => {
    const { member } = await makeTeam();
    for (let i = 0; i < 8; i++) {
      expect((await login(member.email, "wrong-pass-2", freshIp())).status).toBe(401);
    }
    expect((await login(member.email, "wrong-pass-2", freshIp())).status).toBe(429);
  });

  it("a successful sign-in clears the account's failure counter", async () => {
    const { member } = await makeTeam();
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await login(member.email, "wrong-pass-3", ip);
    expect((await login(member.email, TEST_PASSWORD, ip)).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      expect((await login(member.email, "wrong-pass-3", ip)).status).toBe(401);
    }
  });

  it("unknown e-mail addresses are limited too (no free enumeration)", async () => {
    const email = `nobody-${uid()}@test.local`;
    for (let i = 0; i < 8; i++) {
      expect((await login(email, "whatever-1", freshIp())).status).toBe(401);
    }
    expect((await login(email, "whatever-1", freshIp())).status).toBe(429);
  });

  it("one address trying many different accounts is blocked as a whole", async () => {
    const team = await makeTeam();
    const emails = [team.owner, team.admin, team.member, team.guest].map((u) => u.email);
    const other = await makeTeam();
    emails.push(other.owner.email);
    const ip = freshIp();
    // 5 accounts x 6 failures = 30 attempts: no single account reaches its own limit
    for (let round = 0; round < 6; round++) {
      for (const email of emails) expect((await login(email, "wrong-pass-4", ip)).status).toBe(401);
    }
    expect((await login(emails[0]!, "wrong-pass-4", ip)).status).toBe(429);
    // another address is unaffected
    expect((await login(team.member.email, TEST_PASSWORD, freshIp())).status).toBe(200);
  });
});
