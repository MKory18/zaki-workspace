import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEED_OWNER_EMAIL,
  assertSeedAllowed,
  assertStrongEnough,
  generatePassword,
  resolveOwnerEmail,
  resolveOwnerPassword,
} from "../prisma/seed-guard";

const DEMO_PASSWORD = ["owner", "1234"].join("");

describe("seed refuses to run where it must not", () => {
  it("refuses NODE_ENV=production", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(/NODE_ENV=production/);
  });

  it("ALLOW_PROD_SEED=1 is the explicit way past it", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production", ALLOW_PROD_SEED: "1" })).not.toThrow();
  });

  it("any other ALLOW_PROD_SEED value does not count", () => {
    for (const value of ["", "0", "true", "yes", "2"]) {
      expect(() => assertSeedAllowed({ NODE_ENV: "production", ALLOW_PROD_SEED: value })).toThrow();
    }
  });

  it("runs in development, in test and with NODE_ENV unset, against this machine's database", () => {
    const url = "postgresql://zaki:pw@localhost:5433/zaki_workspace";
    expect(() => assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: url })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "test", DATABASE_URL: url })).not.toThrow();
    expect(() => assertSeedAllowed({ DATABASE_URL: url })).not.toThrow();
    expect(() => assertSeedAllowed({})).not.toThrow();
  });

  it("accepts the compose service names and loopback addresses as 'this machine'", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "db", "postgres", "host.docker.internal"]) {
      expect(() => assertSeedAllowed({ DATABASE_URL: `postgresql://u:p@${host}:5432/d` }), host).not.toThrow();
    }
  });

  it("refuses a database on another host even when NODE_ENV is not production (a laptop with a production .env)", () => {
    expect(() => assertSeedAllowed({ DATABASE_URL: "postgresql://u:p@db.internal.example.net:5432/d" })).toThrow(/not this machine/);
    expect(() => assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@10.0.0.5:5432/d" })).toThrow(/10\.0\.0\.5/);
    expect(() => assertSeedAllowed({ DATABASE_URL: "postgresql://u:p@db.internal.example.net:5432/d", ALLOW_PROD_SEED: "1" })).not.toThrow();
  });

  it("does not put the connection string (it carries a password) in the error", () => {
    try {
      assertSeedAllowed({ DATABASE_URL: "postgresql://admin:Sup3rSecret@remote.example.net:5432/d" });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain("Sup3rSecret");
      expect(String(err)).not.toContain("admin");
    }
  });
});

describe("the owner's password", () => {
  it("is random, and different every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });

  it("always satisfies the application's password policy (8+ characters, a letter, a digit)", () => {
    for (let i = 0; i < 200; i += 1) {
      const pw = generatePassword();
      expect(pw.length).toBeGreaterThanOrEqual(16);
      expect(pw).toMatch(/[A-Za-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/^[A-Za-z0-9]+$/);
      expect(() => assertStrongEnough(pw)).not.toThrow();
    }
  });

  it("is never the published demo password", () => {
    for (let i = 0; i < 50; i += 1) expect(generatePassword()).not.toBe(DEMO_PASSWORD);
    expect(resolveOwnerPassword({}).password).not.toBe(DEMO_PASSWORD);
  });

  it("is generated when SEED_OWNER_PASSWORD is not set", () => {
    const r = resolveOwnerPassword({});
    expect(r.generated).toBe(true);
    expect(r.password.length).toBeGreaterThanOrEqual(16);
  });

  it("is taken from SEED_OWNER_PASSWORD when it is set and strong enough", () => {
    const r = resolveOwnerPassword({ SEED_OWNER_PASSWORD: "Correct-horse-9-battery" });
    expect(r).toEqual({ password: "Correct-horse-9-battery", generated: false });
  });

  it("rejects a SEED_OWNER_PASSWORD that breaks the policy, without echoing it", () => {
    for (const weak of ["short1", "onlyletterslong", "123456789012"]) {
      expect(() => resolveOwnerPassword({ SEED_OWNER_PASSWORD: weak })).toThrow(/SEED_OWNER_PASSWORD/);
      try {
        resolveOwnerPassword({ SEED_OWNER_PASSWORD: weak });
      } catch (err) {
        expect(String(err)).not.toContain(weak);
      }
    }
  });
});

describe("the owner's email", () => {
  it("defaults to the local demo address", () => {
    expect(resolveOwnerEmail({})).toBe(DEFAULT_SEED_OWNER_EMAIL);
    expect(resolveOwnerEmail({ SEED_OWNER_EMAIL: "   " })).toBe(DEFAULT_SEED_OWNER_EMAIL);
  });

  it("can be set, and is normalised the way logins are (trimmed, lower case)", () => {
    expect(resolveOwnerEmail({ SEED_OWNER_EMAIL: "  Boss@Example.ORG " })).toBe("boss@example.org");
  });
});
