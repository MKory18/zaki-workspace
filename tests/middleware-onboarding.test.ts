import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../src/middleware";
import { signSessionToken, type SessionClaims } from "../src/lib/session-token";

// New module of this phase, imported where it is used.
const safeNext = async () => (await import("../src/lib/safe-next")).safeNextPath;

const SECRET = process.env["AUTH_SECRET"] as string; // tests/setup.ts

function token(claims: SessionClaims, opts: { ttl?: number; secret?: string } = {}) {
  return signSessionToken(claims, opts.secret ?? SECRET, opts.ttl ?? 3600);
}

function req(pathAndQuery: string, cookie?: string, method = "GET") {
  const headers = new Headers({ host: "localhost:3000" });
  if (cookie !== undefined) headers.set("cookie", `zaki_session=${cookie}`);
  return new NextRequest(`http://localhost:3000${pathAndQuery}`, { method, headers });
}

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";
function location(res: Response): string {
  const loc = res.headers.get("location");
  if (!loc) throw new Error(`expected a redirect, got ${res.status}`);
  const u = new URL(loc);
  return u.pathname + u.search;
}

describe("middleware: the session cookie is verified, not just present", () => {
  it("a valid token lets a page through", async () => {
    const res = await middleware(req("/projects", await token({ userId: "u1", tv: 0 })));
    expect(passes(res)).toBe(true);
  });

  it("a garbage, foreign, expired or version-less token counts as no session (sign-in, with ?next=)", async () => {
    const legacy = await (async () => {
      const { SignJWT } = await import("jose");
      const key = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET)));
      return new SignJWT({ userId: "u1" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(key);
    })();
    const bad = [
      "abc",
      await token({ userId: "u1", tv: 0 }, { secret: "another-secret-of-16+chars" }),
      await token({ userId: "u1", tv: 0 }, { ttl: -60 }),
      legacy,
    ];
    for (const cookie of bad) {
      const res = await middleware(req("/projects", cookie));
      expect(res.status, cookie.slice(0, 12)).toBe(307);
      expect(location(res)).toBe("/login?next=%2Fprojects");
    }
  });

  it("keeps the query string of the page that was asked for", async () => {
    const res = await middleware(req("/projects?workspace=abc"));
    expect(location(res)).toBe("/login?next=%2Fprojects%3Fworkspace%3Dabc");
  });

  it("does not send the browser's own icon request to the sign-in page", async () => {
    expect(passes(await middleware(req("/icon.svg")))).toBe(true);
  });
});

describe("middleware: unfinished onboarding goes to /onboarding", () => {
  it("a token that still owes a password change sends pages to /onboarding?next=", async () => {
    const res = await middleware(req("/projects?tab=board", await token({ userId: "u1", tv: 2, mcp: true })));
    expect(res.status).toBe(307);
    expect(location(res)).toBe("/onboarding?next=%2Fprojects%3Ftab%3Dboard");
  });

  it("a token that still owes the notice does too; from / there is no ?next=", async () => {
    const res = await middleware(req("/", await token({ userId: "u1", tv: 0, tp: true })));
    expect(location(res)).toBe("/onboarding");
  });

  it("leaves /onboarding itself, the API, sign-in pages and static files alone (no loop, routes enforce auth)", async () => {
    const pending = await token({ userId: "u1", tv: 0, mcp: true, tp: true });
    for (const p of ["/onboarding", "/onboarding?next=%2Fprojects", "/api/me", "/api/me/password", "/api/tasks", "/login", "/register", "/icon.svg"]) {
      expect(passes(await middleware(req(p, pending))), p).toBe(true);
    }
    expect(passes(await middleware(req("/api/auth/logout", pending, "POST")))).toBe(true);
  });

  it("a finished person is not sent to /onboarding", async () => {
    const res = await middleware(req("/chat", await token({ userId: "u1", tv: 7 })));
    expect(passes(res)).toBe(true);
  });

  it("an anonymous visitor of /onboarding is sent to sign in (the sign-in decides about the onboarding itself)", async () => {
    const res = await middleware(req("/onboarding"));
    expect(res.status).toBe(307);
    expect(location(res)).toBe("/login");
  });

  it("a ?next= is only ever a path on this site", async () => {
    const res = await middleware(req("//evil.example/x"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") as string).host).toBe("localhost:3000");
    expect(location(res)).toBe("/login");
  });
});

describe("safeNextPath: ?next= never leaves this site", () => {
  it("keeps a plain path on this site, with its query", async () => {
    const safeNextPath = await safeNext();
    expect(safeNextPath("/projects")).toBe("/projects");
    expect(safeNextPath("/projects?tab=board#top")).toBe("/projects?tab=board#top");
    expect(safeNextPath("/u/abc")).toBe("/u/abc");
  });

  it("falls back to / for anything that could reach another site", async () => {
    const safeNextPath = await safeNext();
    for (const evil of [
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/.//evil.example",
      "/a/..//evil.example",
      "https://evil.example",
      "http:/evil.example",
      "javascript:alert(1)",
      "evil.example",
      " /projects",
      "",
    ]) {
      expect(safeNextPath(evil), JSON.stringify(evil)).toBe("/");
    }
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(["/a", "/b"])).toBe("/");
  });

  it("an encoded slash stays a harmless path on this site", async () => {
    const safeNextPath = await safeNext();
    const out = safeNextPath("/%2F%2Fevil.example");
    expect(out.startsWith("/")).toBe(true);
    expect(out.startsWith("//")).toBe(false);
    expect(new URL(out, "https://workspace.example").host).toBe("workspace.example");
  });

  it("never points back into the sign-in or onboarding pages or the API", async () => {
    const safeNextPath = await safeNext();
    for (const p of ["/login", "/login?next=/x", "/register", "/onboarding", "/onboarding?next=/x", "/api/me"]) {
      expect(safeNextPath(p), p).toBe("/");
    }
  });
});

describe("the middleware stays Edge-safe", () => {
  const ROOT = path.resolve(__dirname, "..");
  const importsOf = (file: string) =>
    [...readFileSync(path.join(ROOT, file), "utf8").matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

  it("imports nothing that needs Node or the database", () => {
    expect(importsOf("src/middleware.ts").sort()).toEqual(
      ["@/lib/origin-guard", "@/lib/safe-next", "@/lib/session-token", "next/server"].sort(),
    );
    for (const file of ["src/lib/session-token.ts", "src/lib/safe-next.ts", "src/lib/origin-guard.ts"]) {
      for (const spec of importsOf(file)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^(node:|@\/server|@prisma|\.\.?\/)/);
      }
    }
  });
});
