import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { COOKIE_NAME, verifySessionToken, type SessionClaims } from "@/server/session";
import { db, loginAs, makeTeam } from "./helpers";

/**
 * Fixtures for the sign-in / onboarding / first-run tests (agent LOGIN). Everything is written
 * with `db.*` directly so a fixture never depends on the code under test.
 */

/** The in-memory cookie jar tests/db/setup.ts puts in place of `next/headers`. */
export function cookieJar(): Map<string, string> {
  const jar = (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar;
  if (!jar) throw new Error("tests/db/setup.ts did not run");
  return jar;
}

/** The raw session cookie the last response left in the jar (undefined = signed out). */
export function sessionCookie(): string | undefined {
  return cookieJar().get(COOKIE_NAME);
}

export function setSessionCookie(token: string): void {
  cookieJar().set(COOKIE_NAME, token);
}

/** What the current session cookie says (null = none, or not a valid token). */
export async function sessionClaims(): Promise<SessionClaims | null> {
  const token = sessionCookie();
  return token ? verifySessionToken(token) : null;
}

/**
 * A plain member of a fresh team who still owes the onboarding: `password` = a temporary password
 * to change, `notice` = the transparency notice to accept. Signed in with a cookie that says so,
 * exactly like the one the login route would issue.
 */
export async function pendingMember(owes: { password?: boolean; notice?: boolean }) {
  const team = await makeTeam();
  await db.user.update({
    where: { id: team.member.id },
    data: {
      mustChangePassword: Boolean(owes.password),
      ...(owes.notice ? { transparencyVersion: null, transparencyAcceptedAt: null } : {}),
    },
  });
  await loginAs(team.member.id, { ...(owes.password ? { mcp: true } : {}), ...(owes.notice ? { tp: true } : {}) });
  return team;
}

export async function setMemberStatus(userId: string, status: "ACTIVE" | "SUSPENDED" | "OFFBOARDED"): Promise<void> {
  await db.organizationMember.updateMany({ where: { userId }, data: { status } });
}

/**
 * A second, EMPTY database (every migration applied, not one row), for the tests that need
 * "no organization exists at all" — the shared test database always has organizations in it.
 * Same server and the same safety rule as tests/db/global-setup.ts: localhost only unless
 * ALLOW_REMOTE_TEST_DB=1. `drop()` removes it; the name is random and is the only thing dropped.
 */
export async function emptyDatabase(): Promise<{ client: PrismaClient; drop: () => Promise<void> }> {
  const current = process.env["DATABASE_URL"];
  if (!current) throw new Error("DATABASE_URL is not set: tests/db/global-setup.ts did not run");
  const admin = new URL(current);
  admin.pathname = "/postgres";
  admin.search = "";
  const host = admin.hostname.replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host) && process.env["ALLOW_REMOTE_TEST_DB"] !== "1") {
    throw new Error(`refusing to create a database on non-local host "${host}"`);
  }
  const name = `zaki_test_empty_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const url = new URL(admin.toString());
  url.pathname = `/${name}`;

  const root = new PrismaClient({ datasourceUrl: admin.toString(), log: [] });
  try {
    await root.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await root.$disconnect();
  }
  const dropIt = async () => {
    const cleanup = new PrismaClient({ datasourceUrl: admin.toString(), log: [] });
    try {
      await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await cleanup.$disconnect();
    }
  };
  try {
    execFileSync(process.execPath, [path.resolve(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: "pipe",
    });
  } catch (err) {
    await dropIt();
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`prisma migrate deploy failed on the empty database\n${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`);
  }
  const client = new PrismaClient({ datasourceUrl: url.toString(), log: ["error"] });
  return {
    client,
    drop: async () => {
      await client.$disconnect();
      await dropIt();
    },
  };
}
