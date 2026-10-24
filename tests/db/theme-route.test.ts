import { beforeEach, describe, expect, it } from "vitest";
import * as themeRoute from "@/app/api/me/theme/route";
import { PREF_COOKIE_MAX_AGE } from "@/lib/themes/registry";
import { call, db, loginAs, logout, makeTeam } from "./helpers";
import { pendingMember, setMemberStatus } from "./login-helpers";

/**
 * POST /api/me/theme — a person saves their theme (it follows them to every device) and/or their
 * decoration level; the response sets both cookies for a year (a server-set cookie keeps its year
 * on Safari, which caps the ones a script writes).
 */

function setCookie(headers: Headers, name: string): string | undefined {
  return headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

async function storedTheme(userId: string): Promise<string> {
  return (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { theme: true } })).theme;
}

function post(body: unknown) {
  return call(themeRoute.POST, { method: "POST", url: "http://localhost/api/me/theme", body });
}

beforeEach(() => logout());

describe("POST /api/me/theme: a theme", () => {
  it("saves it on the caller's account and answers { ok, theme }", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const res = await post({ theme: "neon-coast" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, theme: "neon-coast" });
    expect(await storedTheme(member.id)).toBe("neon-coast");
  });

  it("sets zaki_theme for a year, on every path, SameSite=Lax, readable by the page", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const res = await post({ theme: "islamic-epic" });
    const cookie = setCookie(res.headers, "zaki_theme");
    expect(cookie).toMatch(/^zaki_theme=islamic-epic;/);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${PREF_COOKIE_MAX_AGE}`);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toMatch(/HttpOnly/i);
    // the decoration level was not part of the request: its cookie is left alone
    expect(setCookie(res.headers, "zk-decor")).toBeUndefined();
  });

  it("refuses anything that is not one of the four themes (422) and changes nothing", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    await post({ theme: "day" });
    for (const theme of ["system", "dark", "light", "neon", "", "ISLAMIC-CALM", 7, null, ["day"]]) {
      const res = await post({ theme });
      expect(res.status, JSON.stringify(theme)).toBe(422);
      expect(res.json?.error).toBe("validation.failed");
      expect(setCookie(res.headers, "zaki_theme")).toBeUndefined();
    }
    expect(await storedTheme(member.id)).toBe("day");
  });

  it("refuses an empty request, unknown fields and broken JSON (422)", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    expect((await post({})).status).toBe(422);
    expect((await post({ colour: "red" })).status).toBe(422);
    expect((await post({ theme: "day", isAdmin: true })).status).toBe(422);
    const broken = await themeRoute.POST(
      new Request("http://localhost/api/me/theme", { method: "POST", headers: { "content-type": "application/json" }, body: "{theme:" }),
    );
    expect(broken.status).toBe(422);
    expect(await storedTheme(member.id)).toBe("system");
  });

  it("only ever writes the caller's own account", async () => {
    const { member, admin } = await makeTeam();
    await loginAs(member.id);
    await post({ theme: "neon-coast" });
    expect(await storedTheme(admin.id)).toBe("system");
  });
});

describe("POST /api/me/theme: the decoration level", () => {
  it("sets zk-decor for a year and leaves the saved theme alone", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    await post({ theme: "day" });
    const res = await post({ decor: "off" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, theme: "day", decor: "off" });
    const cookie = setCookie(res.headers, "zk-decor");
    expect(cookie).toMatch(/^zk-decor=off;/);
    expect(cookie).toContain(`Max-Age=${PREF_COOKIE_MAX_AGE}`);
    expect(cookie).not.toMatch(/HttpOnly/i);
    expect(setCookie(res.headers, "zaki_theme")).toBeUndefined();
    expect(await storedTheme(member.id)).toBe("day");
  });

  it("theme and level together set both cookies", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const res = await post({ theme: "night", decor: "full" });
    expect(res.json).toEqual({ ok: true, theme: "night", decor: "full" });
    expect(setCookie(res.headers, "zaki_theme")).toMatch(/^zaki_theme=night;/);
    expect(setCookie(res.headers, "zk-decor")).toMatch(/^zk-decor=full;/);
  });

  it("refuses an unknown level (422)", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    for (const decor of ["none", "FULL", "", 2]) {
      const res = await post({ decor });
      expect(res.status, String(decor)).toBe(422);
      expect(setCookie(res.headers, "zk-decor")).toBeUndefined();
    }
  });

  it("answers with the default theme for somebody who never chose one", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    expect((await post({ decor: "light" })).json).toEqual({ ok: true, theme: "night", decor: "light" });
    expect(await storedTheme(member.id)).toBe("system");
  });

  it("a retired theme («إسلامي هادي») is no new choice (422), and one still stored answers as «ليل»", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const refused = await post({ theme: "islamic-calm" });
    expect(refused.status).toBe(422);
    expect(setCookie(refused.headers, "zaki_theme")).toBeUndefined();
    await db.user.update({ where: { id: member.id }, data: { theme: "islamic-calm" } });
    expect((await post({ decor: "off" })).json).toEqual({ ok: true, theme: "night", decor: "off" });
  });
});

describe("POST /api/me/theme: who may call it", () => {
  it("somebody still in the onboarding may choose (the onboarding pages are themed too)", async () => {
    const { member } = await pendingMember({ password: true, notice: true });
    const res = await post({ theme: "islamic-epic" });
    expect(res.status).toBe(200);
    expect(await storedTheme(member.id)).toBe("islamic-epic");
  });

  it("signed out: 401, no cookie, nothing written", async () => {
    const { member } = await makeTeam();
    const res = await post({ theme: "neon-coast" });
    expect(res.status).toBe(401);
    expect(res.json?.error).toBe("auth.required");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await storedTheme(member.id)).toBe("system");
  });

  it("a suspended person's session is no longer honoured: 401, nothing written", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    await setMemberStatus(member.id, "SUSPENDED");
    const res = await post({ theme: "neon-coast" });
    expect(res.status).toBe(401);
    expect(await storedTheme(member.id)).toBe("system");
  });
});
