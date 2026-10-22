import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Boot-time environment contract (src/server/env.ts).
 *
 * Platforms such as Coolify (and compose's `${VAR:-}`) pass a variable that is declared
 * but empty as "". That must mean "not set" for every OPTIONAL variable, not a container
 * that refuses to start. The two required ones stay strict.
 */

const OPTIONAL = ["APP_URL", "LOG_LEVEL", "SESSION_TTL_HOURS", "TRUSTED_PROXY_HOPS", "ENCRYPTION_KEY"] as const;
const REQUIRED = ["DATABASE_URL", "AUTH_SECRET"] as const;
const ALL = [...OPTIONAL, ...REQUIRED];

describe("env", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const n of ALL) saved.set(n, process.env[n]);
    for (const n of OPTIONAL) delete process.env[n];
  });

  afterEach(() => {
    for (const n of ALL) {
      const v = saved.get(n);
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  });

  /** A fresh copy of the module (env() caches), with exactly these variables changed. */
  async function load(vars: Record<string, string | undefined> = {}) {
    vi.resetModules();
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return import("../src/server/env");
  }

  /** The message env() throws, or null when it accepts the environment. */
  async function failure(vars: Record<string, string | undefined>): Promise<string | null> {
    const { env } = await load(vars);
    try {
      env();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  describe("defaults", () => {
    it("every optional variable absent: the documented defaults", async () => {
      const { env } = await load();
      expect(env()).toMatchObject({
        APP_URL: "http://localhost:3000",
        LOG_LEVEL: "info",
        SESSION_TTL_HOURS: 168,
        TRUSTED_PROXY_HOPS: 1,
      });
      expect(env().ENCRYPTION_KEY).toBeUndefined();
    });
  });

  describe("a declared-but-empty optional variable counts as not set", () => {
    it.each(["", "   "])("%j for every optional variable at once", async (blank) => {
      const { env } = await load({
        APP_URL: blank,
        LOG_LEVEL: blank,
        SESSION_TTL_HOURS: blank,
        TRUSTED_PROXY_HOPS: blank,
        ENCRYPTION_KEY: blank,
      });
      expect(env()).toMatchObject({
        APP_URL: "http://localhost:3000",
        LOG_LEVEL: "info",
        SESSION_TTL_HOURS: 168,
        TRUSTED_PROXY_HOPS: 1,
      });
      expect(env().ENCRYPTION_KEY).toBeUndefined();
    });

    it.each(OPTIONAL)("%s on its own", async (name) => {
      expect(await failure({ [name]: "" })).toBeNull();
    });
  });

  describe("the required variables stay strict", () => {
    it("AUTH_SECRET: absent, blank and too short are all refused, and the value is never echoed", async () => {
      const short = "s3cr3t-too-shor"; // 15 characters: one below the minimum of 16
      expect(short).toHaveLength(15);
      expect(await failure({ AUTH_SECRET: undefined })).toMatch(/AUTH_SECRET/);
      expect(await failure({ AUTH_SECRET: "" })).toMatch(/AUTH_SECRET/);
      const message = await failure({ AUTH_SECRET: short });
      expect(message).toMatch(/AUTH_SECRET/);
      expect(message).not.toContain(short);
      expect(await failure({ AUTH_SECRET: "0123456789abcdef" })).toBeNull();
    });

    it("DATABASE_URL: absent and blank are refused", async () => {
      expect(await failure({ DATABASE_URL: undefined })).toMatch(/DATABASE_URL/);
      expect(await failure({ DATABASE_URL: "" })).toMatch(/DATABASE_URL/);
    });
  });

  describe("LOG_LEVEL", () => {
    it.each([
      ["debug", "debug"],
      ["INFO", "info"],
      ["Warn", "warn"],
      ["  ERROR  ", "error"],
    ])("%j is accepted as %s (case-insensitive)", async (raw, expected) => {
      const { env } = await load({ LOG_LEVEL: raw });
      expect(env().LOG_LEVEL).toBe(expected);
    });

    it.each(["verbose", "trace", "1", "info,debug"])("%j is refused, naming LOG_LEVEL", async (raw) => {
      expect(await failure({ LOG_LEVEL: raw })).toMatch(/LOG_LEVEL/);
    });
  });

  describe("SESSION_TTL_HOURS", () => {
    it("a positive whole number of hours", async () => {
      const { env } = await load({ SESSION_TTL_HOURS: " 24 " });
      expect(env().SESSION_TTL_HOURS).toBe(24);
    });

    it.each(["0", "-5", "1.5", "abc", "12h"])("%j is refused, naming SESSION_TTL_HOURS", async (raw) => {
      expect(await failure({ SESSION_TTL_HOURS: raw })).toMatch(/SESSION_TTL_HOURS/);
    });
  });

  describe("TRUSTED_PROXY_HOPS (how many reverse proxies sit in front of the app)", () => {
    it.each(["1", "2", "3", "4", "5", " 2 "])("%j is accepted", async (raw) => {
      const { env } = await load({ TRUSTED_PROXY_HOPS: raw });
      expect(env().TRUSTED_PROXY_HOPS).toBe(Number(raw));
    });

    it.each(["0", "6", "-1", "1.5", "two", "1e1", "99"])("%j is refused, naming TRUSTED_PROXY_HOPS", async (raw) => {
      expect(await failure({ TRUSTED_PROXY_HOPS: raw })).toMatch(/TRUSTED_PROXY_HOPS/);
    });
  });

  describe("APP_URL", () => {
    it.each([
      ["https://x.io", "https://x.io"],
      ["https://x.io/", "https://x.io"],
      ["https://x.io///", "https://x.io"],
      [" https://x.io/ ", "https://x.io"],
      ["https://x.io/ws/", "https://x.io/ws"],
      ["http://localhost:3001/", "http://localhost:3001"],
    ])("%j is normalised once, to %j (no trailing slash)", async (raw, expected) => {
      const { env } = await load({ APP_URL: raw });
      expect(env().APP_URL).toBe(expected);
    });

    it("so `${APP_URL}/api/...` always has exactly one slash", async () => {
      const { env } = await load({ APP_URL: "https://x.io//" });
      expect(`${env().APP_URL}/api/integrations/google/callback`).toBe("https://x.io/api/integrations/google/callback");
    });

    it.each(["x.io", "//x.io", "ftp://x.io", "javascript:alert(1)", "http://", "not a url"])(
      "%j is refused, naming APP_URL",
      async (raw) => {
        expect(await failure({ APP_URL: raw })).toMatch(/APP_URL/);
      },
    );
  });

  describe("appUrl(): the public URL, read at call time", () => {
    it("normalises exactly like env() but follows the CURRENT value (env() is cached)", async () => {
      const m = await load({ APP_URL: "https://a.io/" });
      expect(m.appUrl()).toBe("https://a.io");
      process.env["APP_URL"] = "https://b.io//";
      expect(m.appUrl()).toBe("https://b.io");
      process.env["APP_URL"] = "";
      expect(m.appUrl()).toBe("http://localhost:3000");
      delete process.env["APP_URL"];
      expect(m.appUrl()).toBe("http://localhost:3000");
    });

    it("refuses an invalid value instead of guessing a host", async () => {
      const m = await load({ APP_URL: "https://a.io" });
      process.env["APP_URL"] = "not a url";
      expect(() => m.appUrl()).toThrow(/APP_URL/);
    });
  });
});
