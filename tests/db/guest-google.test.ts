import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as googleRoute from "@/app/api/integrations/google/route";
import * as startRoute from "@/app/api/integrations/google/start/route";
import * as callbackRoute from "@/app/api/integrations/google/callback/route";
import { signState, verifyState } from "@/server/services/google";
import { call, db, loginAs, logout, makeTeam } from "./helpers";

const SECRET_FILE = "Secret price list.xlsx";

/** Stands in for Google: the token endpoint and the Drive file list. Never touches the network. */
function stubGoogle(tokenResponse: Record<string, unknown> = { access_token: "access-1", refresh_token: "refresh-1" }) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) return json(tokenResponse);
    if (url.includes("googleapis.com/drive/v3/files")) {
      return json({
        files: [{ id: "f1", name: SECRET_FILE, mimeType: "application/vnd.ms-excel", webViewLink: "https://drive.example/f1" }],
      });
    }
    return new Response("unexpected request", { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const callbackUrl = (state: string) =>
  `http://localhost/api/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`;

const driveRow = (orgId: string) =>
  db.integration.findUnique({ where: { orgId_type: { orgId, type: "GOOGLE_DRIVE" } } });

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google Drive: starting the OAuth flow", () => {
  it("is refused to a GUEST and to a plain MEMBER with 403 - no redirect to Google", async () => {
    const t = await makeTeam();
    for (const user of [t.guest, t.member]) {
      await loginAs(user.id);
      const res = await call(startRoute.GET, { url: "http://localhost/api/integrations/google/start" });
      expect(res.status).toBe(403);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("is refused to a GUEST even when Google is not configured", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const t = await makeTeam();
    await loginAs(t.guest.id);
    const res = await call(startRoute.GET, { url: "http://localhost/api/integrations/google/start" });
    expect(res.status).toBe(403);
  });

  it("works for the OWNER and an ADMIN: redirects to Google with a state bound to them", async () => {
    const t = await makeTeam();
    for (const user of [t.owner, t.admin]) {
      await loginAs(user.id);
      const res = await call(startRoute.GET, { url: "http://localhost/api/integrations/google/start" });
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location") ?? "");
      expect(location.origin).toBe("https://accounts.google.com");
      expect(verifyState(location.searchParams.get("state") ?? "")).toEqual({ orgId: t.org.id, userId: user.id });
    }
  });

  it("keeps its old answers: not configured -> /automation marker, signed out -> login", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const t = await makeTeam();
    await loginAs(t.admin.id);
    const unconfigured = await call(startRoute.GET, { url: "http://localhost/api/integrations/google/start" });
    expect(unconfigured.status).toBe(307);
    expect(unconfigured.headers.get("location")).toBe("http://localhost/automation?google=not_configured");

    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    logout();
    const signedOut = await call(startRoute.GET, { url: "http://localhost/api/integrations/google/start" });
    expect(signedOut.status).toBe(307);
    expect(signedOut.headers.get("location") ?? "").toContain("/login");
  });
});

describe("Google Drive: finishing the OAuth flow", () => {
  it("is refused to a GUEST and to a plain MEMBER: nothing is exchanged and nothing is stored", async () => {
    const t = await makeTeam();
    for (const user of [t.guest, t.member]) {
      const fetchMock = stubGoogle();
      await loginAs(user.id);
      const res = await call(callbackRoute.GET, { url: callbackUrl(signState(t.org.id, user.id)) });
      expect(res.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await driveRow(t.org.id)).toBeNull();
    }
  });

  it("lets an ADMIN connect Drive for the org", async () => {
    const t = await makeTeam();
    const fetchMock = stubGoogle();
    await loginAs(t.admin.id);
    const res = await call(callbackRoute.GET, { url: callbackUrl(signState(t.org.id, t.admin.id)) });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/automation?google=connected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = await driveRow(t.org.id);
    expect(row?.connected).toBe(true);
    expect(row?.config).toEqual({ connectedBy: t.admin.id });
  });

  it("refuses a state that was signed for somebody else, or for another organization", async () => {
    const mine = await makeTeam();
    const other = await makeTeam();

    // state minted for the owner, replayed by an admin
    const replay = stubGoogle();
    await loginAs(mine.admin.id);
    const stolen = await call(callbackRoute.GET, { url: callbackUrl(signState(mine.org.id, mine.owner.id)) });
    expect(stolen.status).toBe(403);
    expect(replay).not.toHaveBeenCalled();
    expect(await driveRow(mine.org.id)).toBeNull();

    // state minted for another org's admin: must not connect THAT org's Drive
    vi.unstubAllGlobals();
    const cross = stubGoogle();
    const hijack = await call(callbackRoute.GET, { url: callbackUrl(signState(other.org.id, other.admin.id)) });
    expect(hijack.status).toBe(403);
    expect(cross).not.toHaveBeenCalled();
    expect(await driveRow(other.org.id)).toBeNull();
  });

  it("an ADMIN whose code Google rejects is sent back with the reason and nothing is stored", async () => {
    const t = await makeTeam();
    stubGoogle({ error: "invalid_grant" });
    await loginAs(t.admin.id);
    const res = await call(callbackRoute.GET, { url: callbackUrl(signState(t.org.id, t.admin.id)) });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/automation?google=error&reason=invalid_grant");
    expect(await driveRow(t.org.id)).toBeNull();
  });

  it("keeps its old answers for bad input", async () => {
    const t = await makeTeam();
    await loginAs(t.admin.id);
    const missing = await call(callbackRoute.GET, { url: "http://localhost/api/integrations/google/callback" });
    expect(missing.headers.get("location")).toContain("google=error&reason=missing_params");
    const bad = await call(callbackRoute.GET, { url: callbackUrl("not-a-signed-state") });
    expect(bad.headers.get("location")).toContain("google=error&reason=bad_state");
  });
});

describe("Google Drive: listing files", () => {
  async function connectedOrg() {
    const t = await makeTeam();
    stubGoogle();
    await loginAs(t.admin.id);
    const res = await call(callbackRoute.GET, { url: callbackUrl(signState(t.org.id, t.admin.id)) });
    expect(res.headers.get("location")).toBe("http://localhost/automation?google=connected");
    return t;
  }

  it("is refused to a GUEST and to a plain MEMBER - the file names never leave the server", async () => {
    const t = await connectedOrg();
    const fetchMock = stubGoogle();
    for (const user of [t.guest, t.member]) {
      await loginAs(user.id);
      const res = await call(googleRoute.GET, { url: "http://localhost/api/integrations/google?files=1" });
      expect(res.status).toBe(403);
      expect(res.text).not.toContain(SECRET_FILE);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is refused to a GUEST even while Drive is not connected", async () => {
    const t = await makeTeam();
    await loginAs(t.guest.id);
    const res = await call(googleRoute.GET, { url: "http://localhost/api/integrations/google?files=1" });
    expect(res.status).toBe(403);
  });

  it("works for an ADMIN and for the OWNER", async () => {
    const t = await connectedOrg();
    for (const user of [t.admin, t.owner]) {
      stubGoogle();
      await loginAs(user.id);
      const res = await call(googleRoute.GET, { url: "http://localhost/api/integrations/google?files=1" });
      expect(res.status).toBe(200);
      expect((res.json?.["files"] as { name: string }[]).map((f) => f.name)).toEqual([SECRET_FILE]);
    }
  });

  it("the plain connection status stays readable by every org member", async () => {
    const t = await connectedOrg();
    const fetchMock = stubGoogle();
    for (const user of [t.guest, t.member, t.admin]) {
      await loginAs(user.id);
      const res = await call(googleRoute.GET, { url: "http://localhost/api/integrations/google" });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ connected: true, configured: true, files: [] });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disconnect still needs an OWNER or ADMIN", async () => {
    const t = await connectedOrg();
    for (const user of [t.guest, t.member]) {
      await loginAs(user.id);
      expect((await call(googleRoute.DELETE, { method: "DELETE" })).status).toBe(403);
    }
    expect((await driveRow(t.org.id))?.connected).toBe(true);
    await loginAs(t.admin.id);
    expect((await call(googleRoute.DELETE, { method: "DELETE" })).status).toBe(200);
    expect((await driveRow(t.org.id))?.connected ?? false).toBe(false);
  });
});
