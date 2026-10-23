import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { canonicalPath, middleware } from "../src/middleware";
import { signSessionToken } from "../src/lib/session-token";

/**
 * Found by the independent review: Next's production router resolves a static route from the
 * DECODED path as well, so `/%61pi/me/transparency` reaches /api/me/transparency. The cross-site
 * write guard used to look at the raw spelling only and let such a request through.
 */
describe("canonicalPath: the path the way the router reads it", () => {
  it.each([
    ["/api/me", "/api/me"],
    ["/%61pi/me/transparency", "/api/me/transparency"],
    ["/api%2Fme/transparency", "/api/me/transparency"],
    ["/%61%70%69/tasks", "/api/tasks"],
    ["/ap%69/integrations/n8n", "/api/integrations/n8n"],
    ["/%2561pi/tasks", "/api/tasks"], // double-encoded
    ["//api//tasks", "/api/tasks"],
    ["/x/../api/tasks", "/api/tasks"],
    ["/%2e%2e/api/tasks", "/api/tasks"],
    ["/api\\tasks", "/api/tasks"],
    ["/files/a%20b.txt", "/files/a b.txt"],
    ["/", "/"],
  ])("%s is read as %s", (raw, expected) => {
    expect(canonicalPath(raw)).toEqual({ path: expected, malformed: false });
  });

  it("flags an escape it cannot decode", () => {
    expect(canonicalPath("/api/%zz/tasks").malformed).toBe(true);
  });
});

async function write(pathname: string, origin: string) {
  const token = await signSessionToken({ userId: "victim", tv: 0 }, process.env["AUTH_SECRET"] as string, 3600);
  const headers = new Headers({
    host: "workspace.example.com",
    origin,
    cookie: `zaki_session=${token}`,
    "content-type": "text/plain",
  });
  return middleware(new NextRequest(`https://workspace.example.com${pathname}`, { method: "POST", headers }));
}

describe("the cross-site write guard cannot be skipped by spelling /api differently", () => {
  const SPELLINGS = [
    "/api/me/transparency",
    "/%61pi/me/transparency",
    "/api%2Fme/transparency",
    "/%61%70%69/tasks",
    "/ap%69/integrations/n8n",
    "/%2561pi/tasks",
    "//api/tasks",
    "/x/..%2fapi/tasks",
  ];

  it.each(SPELLINGS)("a write from a sibling site to %s is refused", async (spelling) => {
    const res = await write(spelling, "https://sibling.example.com");
    expect(res.status, `x-middleware-next=${res.headers.get("x-middleware-next")}`).toBe(403);
  });

  it("a path with an escape nobody can decode is guarded like an API call", async () => {
    const res = await write("/api/%zz/tasks", "https://sibling.example.com");
    expect(res.status).toBe(403);
  });

  it("the app's own pages still write: same origin passes, whatever the spelling", async () => {
    for (const spelling of ["/api/me/transparency", "/%61pi/me/transparency"]) {
      const res = await write(spelling, "https://workspace.example.com");
      expect(res.status, spelling).not.toBe(403);
    }
  });

  it("a write whose RAW path is an API route is guarded even when its canonical spelling is a page", async () => {
    // Next matches DYNAMIC routes on the raw path and decodes the parameter afterwards:
    // "/api/tasks/..%2F..%2Flogin" is the /api/tasks/[id] handler with id "../../login", while its
    // canonical spelling is "/login" (a public page).
    for (const raw of ["/api/tasks/..%2F..%2Flogin", "/api/projects/..%2F..%2F..%2Fregister", "/api/tasks/%2e%2e%2f%2e%2e%2fonboarding"]) {
      const res = await write(raw, "https://sibling.example.com");
      expect(res.status, raw).toBe(403);
    }
  });

  it("the machine-endpoint exemption needs BOTH spellings to be a machine endpoint", async () => {
    // raw is a machine path, canonical is not ("/api/v1/..%2Ftasks" reads as /api/tasks);
    // canonical is a machine path, raw is not (the raw spelling routes to /api/tasks/[id])
    for (const raw of ["/api/v1/..%2Ftasks", "/api/health/..%2Fme%2Ftransparency", "/api/tasks/..%2F..%2Fapi%2Fv1%2Fideas"]) {
      const res = await write(raw, "https://sibling.example.com");
      expect(res.status, raw).toBe(403);
    }
    // the real machine endpoints stay exempt (they authenticate with their own token or signature)
    for (const raw of ["/api/v1/ideas", "/api/health", "/api/integrations/n8n/inbound"]) {
      const res = await write(raw, "https://sibling.example.com");
      expect(res.headers.get("x-middleware-next"), raw).toBe("1");
    }
  });
});
