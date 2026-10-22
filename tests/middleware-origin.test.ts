import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../src/middleware";
import { originAllowed } from "../src/lib/origin-guard";

describe("originAllowed (cross-site write protection)", () => {
  const base = { method: "POST", origin: null as string | null, host: "workspace.example.com", forwardedHost: null as string | null, secFetchSite: null as string | null, appUrl: "https://workspace.example.com" };

  it("never blocks safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(originAllowed({ ...base, method, origin: "https://evil.example" })).toBe(true);
    }
  });

  it("allows a write from the same origin", () => {
    expect(originAllowed({ ...base, origin: "https://workspace.example.com" })).toBe(true);
  });

  it("allows the configured APP_URL host even when the proxy rewrites Host", () => {
    expect(originAllowed({ ...base, host: "10.0.0.5:3000", origin: "https://workspace.example.com" })).toBe(true);
  });

  it("allows the forwarded host set by the reverse proxy", () => {
    expect(originAllowed({ ...base, host: "10.0.0.5:3000", forwardedHost: "workspace.example.com", appUrl: undefined, origin: "https://workspace.example.com" })).toBe(true);
  });

  it("blocks a write from another site, including a sibling sub-domain", () => {
    expect(originAllowed({ ...base, origin: "https://evil.example" })).toBe(false);
    expect(originAllowed({ ...base, origin: "https://oms.example.com" })).toBe(false);
    expect(originAllowed({ ...base, origin: "https://workspace.example.com.evil.example" })).toBe(false);
  });

  it("blocks the opaque 'null' origin and unparsable origins", () => {
    expect(originAllowed({ ...base, origin: "null" })).toBe(false);
    expect(originAllowed({ ...base, origin: "not a url" })).toBe(false);
  });

  it("without an Origin header it falls back to Fetch Metadata", () => {
    expect(originAllowed({ ...base, secFetchSite: "same-origin" })).toBe(true);
    expect(originAllowed({ ...base, secFetchSite: "none" })).toBe(true);
    expect(originAllowed({ ...base, secFetchSite: "same-site" })).toBe(false);
    expect(originAllowed({ ...base, secFetchSite: "cross-site" })).toBe(false);
  });

  it("allows non-browser clients that send neither header (curl, servers)", () => {
    expect(originAllowed(base)).toBe(true);
  });
});

describe("middleware", () => {
  function req(path: string, init: { method?: string; headers?: Record<string, string>; cookie?: boolean } = {}) {
    const headers = new Headers({ host: "localhost:3000", ...init.headers });
    if (init.cookie) headers.set("cookie", "zaki_session=abc");
    return new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers });
  }

  it("rejects a cross-site write to the API with 403", async () => {
    const res = middleware(req("/api/tasks", { method: "POST", headers: { origin: "https://evil.example" }, cookie: true }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden", message: "origin.mismatch" });
  });

  it("rejects a cross-site LOGIN attempt too (login CSRF)", () => {
    const res = middleware(req("/api/auth/login", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("lets same-origin writes through", () => {
    const res = middleware(req("/api/tasks", { method: "POST", headers: { origin: "http://localhost:3000" }, cookie: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not apply the browser origin rule to machine-to-machine endpoints", () => {
    const inbound = middleware(req("/api/integrations/n8n/inbound", { method: "POST", headers: { origin: "https://n8n.example" } }));
    expect(inbound.headers.get("x-middleware-next")).toBe("1");
    const v1 = middleware(req("/api/v1/ideas", { method: "POST", headers: { origin: "https://other.example" } }));
    expect(v1.headers.get("x-middleware-next")).toBe("1");
  });

  it("still redirects anonymous page requests to /login", () => {
    const res = middleware(req("/projects"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?next=%2Fprojects");
  });
});
