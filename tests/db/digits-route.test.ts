import { beforeEach, describe, expect, it } from "vitest";
import * as digitsRoute from "@/app/api/me/digits/route";
import * as loginRoute from "@/app/api/auth/login/route";
import { PREF_COOKIE_MAX_AGE } from "@/lib/themes/registry";
import { call, db, loginAs, logout, makeTeam, TEST_PASSWORD } from "./helpers";
import { pendingMember, setMemberStatus } from "./login-helpers";

/**
 * «الأرقام: 123 / ١٢٣» on the server: POST /api/me/digits saves the choice on the account (`User.digits`, the
 * additive migration 20261025120000_user_digits) and sets the `zk-digits` cookie for a year; the sign-in brings
 * it to a new device. The drawing itself is the font's (tests/digits-setting.test.ts).
 */

function setCookie(headers: Headers, name: string): string | undefined {
  return headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

async function stored(userId: string): Promise<string> {
  return (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { digits: true } })).digits;
}

function post(body: unknown) {
  return call(digitsRoute.POST, { method: "POST", url: "http://localhost/api/me/digits", body });
}

let n = 0;
/** A fresh client address per sign-in (the limiter counts per address; this range is this file's own). */
function signIn(identifier: string, password: string) {
  n += 1;
  return call(loginRoute.POST, { method: "POST", body: { identifier, password }, headers: { "x-forwarded-for": `100.64.72.${n}` } });
}

beforeEach(() => logout());

describe("the column", () => {
  it("every account starts at «latin» — what everybody sees today (the migration adds it with that default)", async () => {
    const { member, owner } = await makeTeam();
    expect(await stored(member.id)).toBe("latin");
    expect(await stored(owner.id)).toBe("latin");
  });
});

describe("POST /api/me/digits", () => {
  it("saves «arabic» on the caller's account, answers { ok, digits }, and sets the cookie for a year, readable by the page", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const res = await post({ digits: "arabic" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, digits: "arabic" });
    expect(await stored(member.id)).toBe("arabic");
    const cookie = setCookie(res.headers, "zk-digits") ?? "";
    expect(cookie).toMatch(/^zk-digits=arabic;/);
    expect(cookie).toContain(`Max-Age=${PREF_COOKIE_MAX_AGE}`);
    expect(cookie).not.toMatch(/HttpOnly/i);
    // and back
    expect((await post({ digits: "latin" })).json).toEqual({ ok: true, digits: "latin" });
    expect(await stored(member.id)).toBe("latin");
  });

  it("refuses anything that is not a mode (422): nothing written, no cookie", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    for (const body of [{ digits: "hindi" }, { digits: "" }, { digits: 1 }, {}, { digits: "arabic", extra: true }]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(setCookie(res.headers, "zk-digits")).toBeUndefined();
    }
    expect(await stored(member.id)).toBe("latin");
  });

  it("somebody still in the onboarding may choose (its pages show numbers too)", async () => {
    const { member } = await pendingMember({ password: true, notice: true });
    expect((await post({ digits: "arabic" })).status).toBe(200);
    expect(await stored(member.id)).toBe("arabic");
  });

  it("signed out, or suspended: 401 and nothing written", async () => {
    const { member } = await makeTeam();
    const out = await post({ digits: "arabic" });
    expect(out.status).toBe(401);
    expect(out.headers.getSetCookie()).toEqual([]);
    await loginAs(member.id);
    await setMemberStatus(member.id, "SUSPENDED");
    expect((await post({ digits: "arabic" })).status).toBe(401);
    expect(await stored(member.id)).toBe("latin");
  });
});

describe("the sign-in brings the choice to this device", () => {
  it("sets zk-digits from the account — «arabic» when chosen, «latin» otherwise (this device may hold the other)", async () => {
    const { member } = await makeTeam();
    expect(setCookie((await signIn(member.email, TEST_PASSWORD)).headers, "zk-digits")).toMatch(/^zk-digits=latin;/);
    await db.user.update({ where: { id: member.id }, data: { digits: "arabic" } });
    expect(setCookie((await signIn(member.email, TEST_PASSWORD)).headers, "zk-digits")).toMatch(/^zk-digits=arabic;/);
  });

  it("a value that is not a mode (written by hand) reads as «latin»", async () => {
    const { member } = await makeTeam();
    await db.user.update({ where: { id: member.id }, data: { digits: "hindi" } });
    expect(setCookie((await signIn(member.email, TEST_PASSWORD)).headers, "zk-digits")).toMatch(/^zk-digits=latin;/);
  });

  it("a wrong password sets no cookie", async () => {
    const { member } = await makeTeam();
    const res = await signIn(member.email, "not-the-password");
    expect(res.status).not.toBe(200);
    expect(setCookie(res.headers, "zk-digits")).toBeUndefined();
  });
});
