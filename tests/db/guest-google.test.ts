import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as googleRoute from "@/app/api/integrations/google/route";
import * as startRoute from "@/app/api/integrations/google/start/route";
import * as callbackRoute from "@/app/api/integrations/google/callback/route";
import { hmacHex } from "@/server/crypto";
import { signState, verifyState } from "@/server/services/google";
import { call, db, loginAs, logout, makeTeam } from "./helpers";

const SECRET_FILE = "Secret price list.xlsx";

/** The public address of the app. Every redirect must be built from it. */
const APP = "https://workspace.example.com";
/** What `next start` reports as the request address behind a reverse proxy: the bind host, not the public one. */
const BIND_HOST = "http://localhost:3000";

/** Stands in for Google: the token endpoint and the Drive file list. Never touches the network. */
function stubGoogle(tokenResponse: Record<string, unknown> = { access_token: "access-1", refresh_token: "refresh-1" }) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
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
  // pinned: a developer's .env may set another APP_URL, and redirects now follow it
  vi.stubEnv("APP_URL", APP);
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
    expect(unconfigured.headers.get("location")).toBe(`${APP}/automation?google=not_configured`);

    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    logout();
    const signedOut = await call(startRoute.GET, { url: "http://localhost/api/integrations/google/start" });
    expect(signedOut.status).toBe(307);
    expect(signedOut.headers.get("location")).toBe(`${APP}/login?next=%2Fautomation`);
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
    expect(res.headers.get("location")).toBe(`${APP}/automation?google=connected`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = await driveRow(t.org.id);
    expect(row?.connected).toBe(true);
    // the granted scopes are kept too (this stub's answer names none): they decide whether the library goes to Drive
    expect(row?.config).toEqual({ connectedBy: t.admin.id, scope: "" });
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
    expect(res.headers.get("location")).toBe(`${APP}/automation?google=error&reason=invalid_grant`);
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
    expect(res.headers.get("location")).toBe(`${APP}/automation?google=connected`);
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

describe("Google Drive: every redirect is built from APP_URL", () => {
  /** A request as `next start` shows it behind a proxy: the bind host in the URL, hostile forwarding headers. */
  const behindProxy = { host: "attacker.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" };
  const START = `${BIND_HOST}/api/integrations/google/start`;

  it("start: not configured and signed out both go to APP_URL, whatever address the request came in on", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const t = await makeTeam();
    await loginAs(t.admin.id);
    const unconfigured = await call(startRoute.GET, { url: START, headers: behindProxy });
    expect(unconfigured.headers.get("location")).toBe(`${APP}/automation?google=not_configured`);

    logout();
    const signedOut = await call(startRoute.GET, { url: START, headers: behindProxy });
    expect(signedOut.headers.get("location")).toBe(`${APP}/login?next=%2Fautomation`);
  });

  it("callback: every outcome goes to APP_URL, whatever address the request came in on", async () => {
    const t = await makeTeam();
    const go = (state?: string) =>
      call(callbackRoute.GET, {
        url: `${BIND_HOST}/api/integrations/google/callback${state === undefined ? "" : `?code=abc&state=${encodeURIComponent(state)}`}`,
        headers: behindProxy,
      });

    logout();
    expect((await go(signState(t.org.id, t.admin.id))).headers.get("location")).toBe(`${APP}/login?next=%2Fautomation`);

    await loginAs(t.admin.id);
    expect((await go()).headers.get("location")).toBe(`${APP}/automation?google=error&reason=missing_params`);
    expect((await go("not-a-signed-state")).headers.get("location")).toBe(`${APP}/automation?google=error&reason=bad_state`);

    stubGoogle({ error: "invalid_grant" });
    expect((await go(signState(t.org.id, t.admin.id))).headers.get("location")).toBe(`${APP}/automation?google=error&reason=invalid_grant`);

    vi.unstubAllGlobals();
    stubGoogle();
    expect((await go(signState(t.org.id, t.admin.id))).headers.get("location")).toBe(`${APP}/automation?google=connected`);
  });

  it("the redirect URI sent to Google is APP_URL's, not the request address (it is what Google has registered)", async () => {
    vi.stubEnv("APP_URL", "https://other.example.org");
    const t = await makeTeam();
    await loginAs(t.owner.id);
    const start = await call(startRoute.GET, { url: START, headers: behindProxy });
    const google = new URL(start.headers.get("location") ?? "");
    expect(google.searchParams.get("redirect_uri")).toBe("https://other.example.org/api/integrations/google/callback");
  });

  it("a trailing slash in APP_URL never doubles the slash: redirects, the redirect URI sent to Google and the one in the token exchange", async () => {
    for (const configured of [`${APP}/`, `${APP}///`]) {
      vi.stubEnv("APP_URL", configured);
      const t = await makeTeam();
      const fetchMock = stubGoogle();
      await loginAs(t.admin.id);

      const start = await call(startRoute.GET, { url: START });
      const google = new URL(start.headers.get("location") ?? "");
      expect(google.searchParams.get("redirect_uri"), configured).toBe(`${APP}/api/integrations/google/callback`);

      const done = await call(callbackRoute.GET, { url: callbackUrl(signState(t.org.id, t.admin.id)) });
      expect(done.headers.get("location"), configured).toBe(`${APP}/automation?google=connected`);
      const exchange = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(exchange.get("redirect_uri"), configured).toBe(`${APP}/api/integrations/google/callback`);
      vi.unstubAllGlobals();
    }
  });
});

describe("Google Drive: the OAuth state expires", () => {
  const MINUTE = 60_000;

  it("each start issues a different state (it carries a random nonce)", async () => {
    const t = await makeTeam();
    await loginAs(t.admin.id);
    const states = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const res = await call(startRoute.GET, { url: "http://localhost/api/integrations/google/start" });
      states.add(new URL(res.headers.get("location") ?? "").searchParams.get("state") ?? "");
    }
    expect(states.size).toBe(3);
  });

  it("a state older than ten minutes is refused at the callback: nothing is exchanged, nothing is stored", async () => {
    const t = await makeTeam();
    const fetchMock = stubGoogle();
    await loginAs(t.admin.id);
    const stale = signState(t.org.id, t.admin.id, new Date(Date.now() - 11 * MINUTE));
    const res = await call(callbackRoute.GET, { url: callbackUrl(stale) });
    expect(res.headers.get("location")).toBe(`${APP}/automation?google=error&reason=bad_state`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await driveRow(t.org.id)).toBeNull();
  });

  it("a state dated in the future is refused too", async () => {
    const t = await makeTeam();
    const fetchMock = stubGoogle();
    await loginAs(t.admin.id);
    const future = signState(t.org.id, t.admin.id, new Date(Date.now() + 5 * MINUTE));
    const res = await call(callbackRoute.GET, { url: callbackUrl(future) });
    expect(res.headers.get("location")).toBe(`${APP}/automation?google=error&reason=bad_state`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await driveRow(t.org.id)).toBeNull();
  });

  it("the old deterministic state (orgId.userId.signature), which never expired, is refused", async () => {
    const t = await makeTeam();
    const fetchMock = stubGoogle();
    await loginAs(t.admin.id);
    const legacy = `${t.org.id}.${t.admin.id}.${hmacHex(process.env["AUTH_SECRET"] ?? "", `${t.org.id}.${t.admin.id}`)}`;
    const res = await call(callbackRoute.GET, { url: callbackUrl(legacy) });
    expect(res.headers.get("location")).toBe(`${APP}/automation?google=error&reason=bad_state`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a state a few minutes old still completes the flow, and it stays bound to the person it was issued to", async () => {
    const t = await makeTeam();
    const fetchMock = stubGoogle();
    await loginAs(t.admin.id);
    const aged = signState(t.org.id, t.admin.id, new Date(Date.now() - 9 * MINUTE));
    const ok = await call(callbackRoute.GET, { url: callbackUrl(aged) });
    expect(ok.headers.get("location")).toBe(`${APP}/automation?google=connected`);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // fresh, but minted for the owner: an admin cannot finish the owner's flow
    const other = await makeTeam();
    await loginAs(other.admin.id);
    const stolen = await call(callbackRoute.GET, { url: callbackUrl(signState(other.org.id, other.owner.id)) });
    expect(stolen.status).toBe(403);
  });
});
