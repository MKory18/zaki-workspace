import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Independent review (A): the three Phase 1 migrations on REALISTIC pre-Phase-1 data.
 *
 * A scratch database (random name, same local server as the test database, dropped afterwards) gets
 * every migration BEFORE Phase 1, then a production-like data set written with plain SQL (two
 * companies with workspaces, one without any, a person in two companies, guests with stray
 * MEMBER/ADMIN rows, a restricted staff member, a leftover row of somebody who left), then the three
 * Phase 1 migrations. The result is checked against the rules the rollout document states, and
 * against what each person could open / see BEFORE (the pre-Phase-1 code, commit bbc0df8:
 * requireWorkspace let any non-guest member in; accessibleWorkspaceIds — every list, page and
 * search — showed OWNER/ADMIN everything and everybody else only the spaces they were put in).
 */

const PHASE1 = ["20261023090000_org_role_lead", "20261023091000_identity_status", "20261023092000_membership_backfill"];
const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");

type OrgRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
type WsRole = "ADMIN" | "MEMBER" | "GUEST";

let client: PrismaClient;
let adminUrl: URL;
let scratchUrl: string;
let dbName: string;
let tmp: string;

function deploy(): void {
  execFileSync(
    process.execPath,
    [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(tmp, "schema.prisma")],
    { env: { ...process.env, DATABASE_URL: scratchUrl }, stdio: "pipe" },
  );
}

function copyMigration(name: string): void {
  cpSync(path.join(MIGRATIONS, name), path.join(tmp, "migrations", name), { recursive: true });
}

// ---------- the data set (pre-Phase-1 columns only) ----------

const ids = {
  orgA: "orgA",
  orgB: "orgB_noworkspace",
  orgC: "orgC",
  wMain: "wMain",
  wMgmt: "wMgmt", // only the admins were put in it: plain members never saw it
  wSales: "wSales",
  wC: "wC",
};
const people = {
  owner: { id: "u_owner" },
  admin1: { id: "u_admin1" }, // has a MEMBER row in wMgmt -> must become ADMIN
  admin2: { id: "u_admin2" }, // no rows at all
  member1: { id: "u_member1" }, // MEMBER in wMain, restricted to GUEST in wSales -> must stay GUEST
  member2: { id: "u_member2" }, // space ADMIN of wSales -> must stay ADMIN
  member3: { id: "u_member3" }, // never put in any space
  guest1: { id: "u_guest1" }, // stray MEMBER row in wMain and ADMIN row in wSales -> both GUEST
  guest2: { id: "u_guest2" }, // no rows -> nothing
  both: { id: "u_both" }, // MEMBER of A (oldest) and ADMIN of C
  partner: { id: "u_partner" }, // GUEST of A, MEMBER of C
  ownerB: { id: "u_ownerB" },
  memberB: { id: "u_memberB" },
  ownerC: { id: "u_ownerC" },
  leaver: { id: "u_leaver" }, // removed from A long ago (membership row deleted), leftover space row
};

const ORG_MEMBERS: [string, string, OrgRole, string][] = [
  [ids.orgA, people.owner.id, "OWNER", "2026-01-01"],
  [ids.orgA, people.admin1.id, "ADMIN", "2026-01-02"],
  [ids.orgA, people.admin2.id, "ADMIN", "2026-01-03"],
  [ids.orgA, people.member1.id, "MEMBER", "2026-01-04"],
  [ids.orgA, people.member2.id, "MEMBER", "2026-01-05"],
  [ids.orgA, people.member3.id, "MEMBER", "2026-01-06"],
  [ids.orgA, people.guest1.id, "GUEST", "2026-01-07"],
  [ids.orgA, people.guest2.id, "GUEST", "2026-01-08"],
  [ids.orgA, people.both.id, "MEMBER", "2026-01-09"],
  [ids.orgA, people.partner.id, "GUEST", "2026-01-10"],
  [ids.orgB, people.ownerB.id, "OWNER", "2026-02-01"],
  [ids.orgB, people.memberB.id, "MEMBER", "2026-02-02"],
  [ids.orgC, people.ownerC.id, "OWNER", "2026-03-01"],
  [ids.orgC, people.both.id, "ADMIN", "2026-03-02"],
  [ids.orgC, people.partner.id, "MEMBER", "2026-03-03"],
];

const WS_ROWS: [string, string, WsRole][] = [
  [ids.wMain, people.owner.id, "ADMIN"],
  [ids.wMgmt, people.admin1.id, "MEMBER"],
  [ids.wMain, people.member1.id, "MEMBER"],
  [ids.wSales, people.member1.id, "GUEST"],
  [ids.wSales, people.member2.id, "ADMIN"],
  [ids.wMain, people.guest1.id, "MEMBER"],
  [ids.wSales, people.guest1.id, "ADMIN"],
  [ids.wSales, people.partner.id, "GUEST"],
  [ids.wMain, people.leaver.id, "MEMBER"],
];

const WORKSPACES: [string, string][] = [
  [ids.wMain, ids.orgA],
  [ids.wMgmt, ids.orgA],
  [ids.wSales, ids.orgA],
  [ids.wC, ids.orgC],
];

async function seedOldData(): Promise<void> {
  const run = (sql: string, ...values: unknown[]) => client.$executeRawUnsafe(sql, ...values);
  for (const [i, org] of [ids.orgA, ids.orgB, ids.orgC].entries()) {
    await run(
      `INSERT INTO "Organization" ("id","name","slug","keyPrefix","joinCode","updatedAt") VALUES ($1,$2,$3,$4,$5,now())`,
      org,
      `Company ${org}`,
      `slug-${org}`,
      `KP${i}`,
      `JOIN${i}AAA`,
    );
  }
  for (const p of Object.values(people)) {
    await run(
      `INSERT INTO "User" ("id","email","name","passwordHash","updatedAt") VALUES ($1,$2,$3,$4,now())`,
      p.id,
      `${p.id}@company.test`,
      `Name ${p.id}`,
      "$2a$12$abcdefghijklmnopqrstuuJ8m7wS3zKp1f0W7xQm2cZr1u9O2dE6S",
    );
  }
  for (const [orgId, userId, role, createdAt] of ORG_MEMBERS) {
    await run(
      `INSERT INTO "OrganizationMember" ("id","organizationId","userId","role","createdAt") VALUES ($1,$2,$3,$4::"OrgRole",$5::timestamp)`,
      `om_${orgId}_${userId}`,
      orgId,
      userId,
      role,
      createdAt,
    );
  }
  for (const [wsId, orgId] of WORKSPACES) {
    await run(
      `INSERT INTO "Workspace" ("id","organizationId","name","slug","updatedAt") VALUES ($1,$2,$3,$4,now())`,
      wsId,
      orgId,
      `Space ${wsId}`,
      `ws-${wsId}`,
    );
  }
  for (const [wsId, userId, role] of WS_ROWS) {
    await run(
      `INSERT INTO "WorkspaceMember" ("id","workspaceId","userId","role") VALUES ($1,$2,$3,$4::"WorkspaceRole")`,
      `old_${wsId}_${userId}`,
      wsId,
      userId,
      role,
    );
  }
}

interface WsRow {
  id: string;
  workspaceId: string;
  userId: string;
  role: WsRole;
}

async function wsRows(): Promise<WsRow[]> {
  return client.$queryRawUnsafe<WsRow[]>(
    `SELECT "id","workspaceId","userId","role"::text AS "role" FROM "WorkspaceMember" ORDER BY "workspaceId","userId"`,
  );
}

const orgOfWs = new Map(WORKSPACES);
const orgRoleOf = (orgId: string, userId: string): OrgRole | undefined =>
  ORG_MEMBERS.find(([o, u]) => o === orgId && u === userId)?.[2];

/** Pre-Phase-1 requireWorkspace: a row lets anybody in; without one, every non-guest member of the org. */
function couldOpenBefore(rows: WsRow[], userId: string, wsId: string): boolean {
  if (rows.some((r) => r.workspaceId === wsId && r.userId === userId)) return true;
  const role = orgRoleOf(orgOfWs.get(wsId) as string, userId);
  return role !== undefined && role !== "GUEST";
}

/** Pre-Phase-1 accessibleWorkspaceIds (lists, pages, search): OWNER/ADMIN everything of their orgs, others their rows. */
function sawBefore(rows: WsRow[], userId: string, wsId: string): boolean {
  const role = orgRoleOf(orgOfWs.get(wsId) as string, userId);
  if (role === undefined) return false;
  if (role === "OWNER" || role === "ADMIN") return true;
  return rows.some((r) => r.workspaceId === wsId && r.userId === userId);
}

/** Phase 1 requireWorkspace / accessibleWorkspaceIds: an ACTIVE member of the org; the OWNER needs no row. */
function canOpenAfter(rows: WsRow[], userId: string, wsId: string): boolean {
  const role = orgRoleOf(orgOfWs.get(wsId) as string, userId);
  if (role === undefined) return false;
  if (role === "OWNER") return true;
  return rows.some((r) => r.workspaceId === wsId && r.userId === userId);
}

let before: WsRow[] = [];
let after: WsRow[] = [];

beforeAll(async () => {
  const current = process.env["DATABASE_URL"];
  if (!current) throw new Error("DATABASE_URL is not set: tests/db/global-setup.ts did not run");
  adminUrl = new URL(current);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const host = adminUrl.hostname.replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host) && process.env["ALLOW_REMOTE_TEST_DB"] !== "1") {
    throw new Error(`refusing to create a database on non-local host "${host}"`);
  }
  dbName = `zaki_review_a_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const url = new URL(adminUrl.toString());
  url.pathname = `/${dbName}`;
  scratchUrl = url.toString();
  const root = new PrismaClient({ datasourceUrl: adminUrl.toString(), log: [] });
  try {
    await root.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await root.$disconnect();
  }

  tmp = mkdtempSync(path.join(os.tmpdir(), "review-a-backfill-"));
  mkdirSync(path.join(tmp, "migrations"));
  copyFileSync(path.join(ROOT, "prisma", "schema.prisma"), path.join(tmp, "schema.prisma"));
  copyFileSync(path.join(MIGRATIONS, "migration_lock.toml"), path.join(tmp, "migrations", "migration_lock.toml"));
  const older = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name < PHASE1[0]!)
    .map((d) => d.name);
  for (const name of older) copyMigration(name);
  deploy(); // the database as production has it today

  client = new PrismaClient({ datasourceUrl: scratchUrl, log: ["error"] });
  await seedOldData();
  before = await wsRows();

  for (const name of PHASE1) copyMigration(name);
  deploy(); // the release
  after = await wsRows();
}, 240_000);

afterAll(async () => {
  await client?.$disconnect();
  if (dbName) {
    const cleanup = new PrismaClient({ datasourceUrl: adminUrl.toString(), log: [] });
    try {
      await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } finally {
      await cleanup.$disconnect();
    }
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const rowOf = (rows: WsRow[], wsId: string, userId: string) =>
  rows.find((r) => r.workspaceId === wsId && r.userId === userId);

describe("review A: the Phase 1 migrations on realistic data", () => {
  it("apply cleanly on top of the existing data, and LEAD sits between ADMIN and MEMBER", async () => {
    const applied = await client.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
      `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name = ANY($1)`,
      PHASE1,
    );
    expect(applied.map((m) => m.migration_name).sort()).toEqual([...PHASE1].sort());
    expect(applied.every((m) => m.finished_at !== null)).toBe(true);
    const labels = await client.$queryRawUnsafe<{ label: string }[]>(
      `SELECT unnest(enum_range(NULL::"OrgRole"))::text AS label`,
    );
    expect(labels.map((l) => l.label)).toEqual(["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"]);
  });

  it("admins become ADMIN of every space of their company, members MEMBER (a GUEST or ADMIN row is kept), owners get nothing new, guests get nothing new and only GUEST rows", () => {
    for (const [wsId, orgId] of WORKSPACES) {
      for (const [o, userId, role] of ORG_MEMBERS) {
        if (o !== orgId) continue;
        const row = rowOf(after, wsId, userId);
        const old = rowOf(before, wsId, userId);
        const label = `${userId} in ${wsId}`;
        if (role === "OWNER") expect(row?.role, label).toBe(old?.role); // the owner needs no row: only what was there
        else if (role === "ADMIN") expect(row?.role, label).toBe("ADMIN");
        else if (role === "MEMBER") expect(row?.role, label).toBe(old && old.role !== "MEMBER" ? old.role : "MEMBER");
        else expect(row?.role, label).toBe(old ? "GUEST" : undefined);
      }
    }
    // a space of company C only gets company C's people, whatever they are elsewhere
    expect(after.filter((r) => r.workspaceId === ids.wC).map((r) => [r.userId, r.role]).sort()).toEqual(
      [
        [people.both.id, "ADMIN"],
        [people.partner.id, "MEMBER"],
      ].sort(),
    );
    // company B has no space: nobody of B got a row
    expect(after.some((r) => r.userId === people.ownerB.id || r.userId === people.memberB.id)).toBe(false);
  });

  it("delete nothing: every old space row, person, company and membership is still there", async () => {
    for (const old of before) expect(after.find((r) => r.id === old.id), old.id).toBeDefined();
    const counts = await client.$queryRawUnsafe<{ users: bigint; orgs: bigint; members: bigint }[]>(
      `SELECT (SELECT count(*) FROM "User") AS users, (SELECT count(*) FROM "Organization") AS orgs, (SELECT count(*) FROM "OrganizationMember") AS members`,
    );
    expect(counts[0]).toEqual({
      users: BigInt(Object.keys(people).length),
      orgs: 3n,
      members: BigInt(ORG_MEMBERS.length),
    });
  });

  it("give every existing row a safe default: ACTIVE, version 0, no temporary password, notice still to accept", async () => {
    const users = await client.$queryRawUnsafe<
      { tokenVersion: number; mustChangePassword: boolean; transparencyVersion: number | null; username: string | null; email: string }[]
    >(`SELECT "tokenVersion","mustChangePassword","transparencyVersion","username","email" FROM "User"`);
    for (const u of users) {
      expect(u).toMatchObject({ tokenVersion: 0, mustChangePassword: false, transparencyVersion: null, username: null });
      expect(u.email).toMatch(/@company\.test$/);
    }
    const statuses = await client.$queryRawUnsafe<{ status: string }[]>(`SELECT DISTINCT "status"::text AS status FROM "OrganizationMember"`);
    expect(statuses).toEqual([{ status: "ACTIVE" }]);
    const orgs = await client.$queryRawUnsafe<{ settings: unknown; timezone: string }[]>(`SELECT "settings","timezone" FROM "Organization"`);
    for (const o of orgs) expect(o).toEqual({ settings: {}, timezone: "Asia/Damascus" });
  });

  it("lock nobody out: every space a current member could open before, they can open after", () => {
    for (const [wsId] of WORKSPACES) {
      for (const [, userId] of ORG_MEMBERS) {
        if (couldOpenBefore(before, userId, wsId)) expect(canOpenAfter(after, userId, wsId), `${userId} in ${wsId}`).toBe(true);
      }
    }
    // (the leaver's leftover row opened wMain before — the old check honoured any row — and no longer
    // does: intended, they are not a member of company A any more)
    expect(couldOpenBefore(before, people.leaver.id, ids.wMain)).toBe(true);
    expect(canOpenAfter(after, people.leaver.id, ids.wMain)).toBe(false);
  });

  it("are safe to run twice: replaying the backfill changes nothing", async () => {
    const sql = readFileSync(path.join(MIGRATIONS, PHASE1[2]!, "migration.sql"), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await client.$executeRawUnsafe(statement);
    }
    expect(await wsRows()).toEqual(after);
  });

  it("[decided in the plan] every member is put into every space on deploy day, so nobody is locked out (the owner trims afterwards)", () => {
    // Before: lists showed a MEMBER only the spaces they were put in, but any space could be opened
    // by its link. The plan chose continuity over privacy for the first day: every member gets a row
    // in every space of their company and the owner removes what should not be there, from the app
    // (docs/PHASE1-ROLLOUT.md says so, with the preview query). If the owner decides otherwise
    // before the first deploy, step 1 of the migration is limited to ADMIN and this test inverts.
    for (const [wsId, orgId] of WORKSPACES) {
      for (const [o, userId, role] of ORG_MEMBERS) {
        if (o !== orgId || role !== "MEMBER") continue;
        expect(canOpenAfter(after, userId, wsId), `${userId} -> ${wsId}`).toBe(true);
      }
    }
  });

  it("[design] the OWNER gets no space rows: the owner opens every space without one and leaves no trace", () => {
    // AGENTS.md (Access model): "the owner needs no row, and reading as the owner leaves no trace: no
    // membership". The backfill gives the owner an ADMIN row in every space, so the owner is listed
    // as a member of every space that existed on deploy day.
    const ownerRowsCreated = after.filter(
      (r) => [people.owner.id, people.ownerC.id].includes(r.userId) && !before.some((b) => b.id === r.id),
    );
    expect(ownerRowsCreated.map((r) => `${r.userId} -> ${r.workspaceId}`)).toEqual([]);
  });
});
