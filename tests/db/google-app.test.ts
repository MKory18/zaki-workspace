import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as appRoute from "@/app/api/integrations/google/app/route";
import * as statusRoute from "@/app/api/integrations/google/route";
import * as startRoute from "@/app/api/integrations/google/start/route";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * «مفاتيح جوجل» typed on the site (the owner's ask, 2026-10-27: «بدي ادخلها بالسايت»): whoever runs integrations
 * saves the Google app's id and secret on «الأتمتة»; the secret is kept encrypted and never comes back; the connect
 * button then sends the person to Google with that app; the server's own settings, when set, still win.
 */
const ID = "123456789012-exampleexampleexample.apps.googleusercontent.com";
const SECRET = "dummy-placeholder-client-secret";
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const saveApp = (body: unknown) => call(appRoute.POST, { body });

describe("the Google app typed on the site", () => {
  it("the owner saves it: Drive is configured from the site, and the secret is never sent back", async () => {
    const t = await makeTeam();
    await loginAs(t.owner.id);
    expect((await call(statusRoute.GET)).json).toMatchObject({ configured: false, appSource: null });
    expect((await saveApp({ clientId: ID, clientSecret: SECRET })).status).toBe(200);

    const status = await call(statusRoute.GET);
    expect(status.json).toMatchObject({ configured: true, appSource: "site", connected: false });
    expect(String(status.json?.["redirectUri"])).toContain("/api/integrations/google/callback");
    expect(status.text).not.toContain(SECRET);
    const org = await db.organization.findUniqueOrThrow({ where: { id: t.org.id }, select: { settings: true } });
    expect(JSON.stringify(org.settings)).toContain(ID);
    expect(JSON.stringify(org.settings)).not.toContain(SECRET);
  });

  it("connecting sends the person to Google with that app", async () => {
    const t = await makeTeam();
    await loginAs(t.owner.id);
    await saveApp({ clientId: ID, clientSecret: SECRET });
    const res = await call(startRoute.GET);
    expect(res.status).toBe(307);
    const to = new URL(String(res.headers.get("location")));
    expect(to.host).toBe("accounts.google.com");
    expect(to.searchParams.get("client_id")).toBe(ID);
  });

  it("a member who does not run integrations is refused; a wrong id is refused with its own message", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    expect((await saveApp({ clientId: ID, clientSecret: SECRET })).status).toBe(403);
    await loginAs(t.owner.id);
    const bad = await saveApp({ clientId: "not-a-google-id", clientSecret: SECRET });
    expect(bad.status).toBe(422);
    expect(bad.text).toContain("google.app.bad_id");
  });

  it("forgotten, Drive is not configured again; the server's own settings win over the site's", async () => {
    const t = await makeTeam();
    await loginAs(t.owner.id);
    await saveApp({ clientId: ID, clientSecret: SECRET });
    expect((await call(appRoute.DELETE, { method: "DELETE" })).status).toBe(200);
    expect((await call(statusRoute.GET)).json).toMatchObject({ configured: false, appSource: null });

    process.env["GOOGLE_CLIENT_ID"] = "1-env.apps.googleusercontent.com";
    process.env["GOOGLE_CLIENT_SECRET"] = "env-secret";
    await saveApp({ clientId: ID, clientSecret: SECRET });
    expect((await call(statusRoute.GET)).json).toMatchObject({ configured: true, appSource: "env" });
  });
});
