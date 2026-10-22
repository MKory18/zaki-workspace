import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Creates a fresh database for the whole `test:db` run and applies every
 * migration to it. The database name is random and is the only thing this
 * file ever creates or drops.
 *
 * Which server: `TEST_DATABASE_ADMIN_URL` if set, otherwise the server named by
 * `DATABASE_URL` (environment or `.env`) with the database part replaced by
 * `postgres`. The role needs CREATEDB.
 *
 * Safety: refuses any host other than localhost unless ALLOW_REMOTE_TEST_DB=1,
 * so a production DATABASE_URL in the shell can never be used by accident.
 */

function readDotEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), ".env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function adminUrl(): URL {
  const dot = readDotEnv();
  const base =
    process.env["TEST_DATABASE_ADMIN_URL"] ??
    dot["TEST_DATABASE_ADMIN_URL"] ??
    process.env["DATABASE_URL"] ??
    dot["DATABASE_URL"];
  if (!base) {
    throw new Error(
      "test:db needs a Postgres server: set TEST_DATABASE_ADMIN_URL (or DATABASE_URL) — e.g. postgresql://zaki:zaki_local@localhost:5433/postgres",
    );
  }
  const url = new URL(base);
  url.pathname = "/postgres";
  url.search = "";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local && process.env["ALLOW_REMOTE_TEST_DB"] !== "1") {
    throw new Error(
      `test:db refuses to create databases on non-local host "${host}". Set ALLOW_REMOTE_TEST_DB=1 only for a disposable server.`,
    );
  }
  return url;
}

export default async function setup(): Promise<() => Promise<void>> {
  const admin = adminUrl();
  const name = `zaki_test_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const testUrl = new URL(admin.toString());
  testUrl.pathname = `/${name}`;

  const root = new PrismaClient({ datasourceUrl: admin.toString(), log: [] });
  try {
    await root.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await root.$disconnect();
  }

  try {
    execFileSync(process.execPath, [path.resolve(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
      stdio: "pipe",
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `prisma migrate deploy failed on the test database\n${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`,
    );
  }

  // Workers are spawned after this function returns, so they inherit these.
  process.env["DATABASE_URL"] = testUrl.toString();
  process.env["AUTH_SECRET"] = process.env["AUTH_SECRET"] ?? "test-secret-at-least-16-chars";
  process.env["TEST_DB_NAME"] = name;

  return async () => {
    if (process.env["KEEP_TEST_DB"] === "1") {
      console.warn(`[test:db] keeping database ${name}`);
      return;
    }
    const cleanup = new PrismaClient({ datasourceUrl: admin.toString(), log: [] });
    try {
      await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await cleanup.$disconnect();
    }
  };
}
