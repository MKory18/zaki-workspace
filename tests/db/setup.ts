import { vi } from "vitest";

/**
 * Per-file setup for the database suite.
 *
 * `next/headers` only works inside a request, so it is replaced by an
 * in-memory cookie jar. Tests sign in with `loginAs()` (helpers.ts), which puts
 * a REAL session token in the jar — the production verification path is the
 * one under test.
 */
process.env["AUTH_SECRET"] = process.env["AUTH_SECRET"] ?? "test-secret-at-least-16-chars";

const jar = new Map<string, string>();
(globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar = jar;

// Next 14.2's `cookies()` is SYNCHRONOUS; some call sites still `await` it (and await on a plain
// object is a no-op), so the stub is a plain function, never an async one — an async stub made
// every un-awaited call site read `.get` off a Promise ("cookies(...).get is not a function").
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));
