import { beforeEach, describe, expect, it } from "vitest";
import * as loginRoute from "@/app/api/auth/login/route";
import { PREF_COOKIE_MAX_AGE } from "@/lib/themes/registry";
import { call, db, logout, makeTeam, TEST_PASSWORD } from "./helpers";
import { setMemberStatus } from "./login-helpers";

/**
 * Signing in on a new device brings the person's theme with them: the login response sets
 * `zaki_theme` from `User.theme`, so the very first page after it is painted in their theme.
 * Somebody who never chose (the old "system" value) or holds an old light/dark value gets no
 * theme cookie: the device keeps whatever it shows.
 */

let n = 0;
/** A fresh client address per call (the sign-in limiter counts per address; these never collide with other files). */
function freshIp(): string {
  n += 1;
  return `100.64.71.${n}`;
}

function signIn(identifier: string, password: string) {
  return call(loginRoute.POST, { method: "POST", body: { identifier, password }, headers: { "x-forwarded-for": freshIp() } });
}

function themeCookie(headers: Headers): string | undefined {
  return headers.getSetCookie().find((c) => c.startsWith("zaki_theme="));
}

beforeEach(() => logout());

describe("sign-in brings the saved theme to this device", () => {
  it("a person who chose a theme gets it as the zaki_theme cookie, for a year, readable by the page", async () => {
    const { member } = await makeTeam();
    await db.user.update({ where: { id: member.id }, data: { theme: "islamic-epic" } });
    const res = await signIn(member.email, TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, next: "/" });
    const cookie = themeCookie(res.headers);
    expect(cookie).toMatch(/^zaki_theme=islamic-epic;/);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${PREF_COOKIE_MAX_AGE}`);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toMatch(/HttpOnly/i);
  });

  it("each of the four themes comes back as itself", async () => {
    for (const theme of ["islamic-calm", "islamic-epic", "neon-coast", "day"]) {
      const { member } = await makeTeam();
      await db.user.update({ where: { id: member.id }, data: { theme } });
      expect(themeCookie((await signIn(member.email, TEST_PASSWORD)).headers), theme).toMatch(new RegExp(`^zaki_theme=${theme};`));
    }
  });

  it("somebody who never chose ('system') or holds an old or unknown value gets no theme cookie", async () => {
    for (const theme of ["system", "dark", "light", "neon", ""]) {
      const { member } = await makeTeam();
      await db.user.update({ where: { id: member.id }, data: { theme } });
      const res = await signIn(member.email, TEST_PASSWORD);
      expect(res.status, theme).toBe(200);
      expect(themeCookie(res.headers), theme).toBeUndefined();
    }
  });

  it("a wrong password or a suspended account sets no theme cookie", async () => {
    const { member } = await makeTeam();
    await db.user.update({ where: { id: member.id }, data: { theme: "neon-coast" } });
    const wrong = await signIn(member.email, "Wrong-pass-71");
    expect(wrong.status).toBe(401);
    expect(themeCookie(wrong.headers)).toBeUndefined();

    await setMemberStatus(member.id, "SUSPENDED");
    const refused = await signIn(member.email, TEST_PASSWORD);
    expect(refused.status).toBe(403);
    expect(themeCookie(refused.headers)).toBeUndefined();
  });
});
