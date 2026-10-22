import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqlStatements } from "../../scripts/lint-migrations.mjs";

/**
 * Phase 3, wave A (data): the data move of the chat, on REALISTIC pre-move data.
 *
 * A scratch database (random name, same local server as the test database, dropped afterwards) gets
 * every migration BEFORE Phase 3, then a production-like set of old rows written with plain SQL
 * (three companies; an owner, an admin, a lead, members, a suspended and an offboarded person, a guest
 * and a stranger; departments with and without a lead; legacy groups; DMs with duplicates, ties and
 * broken rows; messages, replies, reactions, read marks), then the three Phase 3 migrations.
 * The result is checked against the rules of the plan, row by row:
 *
 *   - every company gets its HQ space and its five topics, with the people who belong there and NOT the
 *     owner (he reads silently, no row), not a guest, not a suspended or offboarded person;
 *   - every department gets a space with its people (the lead is the space ADMIN) and a "general" topic;
 *   - every legacy group becomes a space whose people are the group's people, and the conversation itself
 *     becomes the "general" topic of it - same id, same messages, same read marks;
 *   - only the OLDEST DM of a pair gets its dmKey (a pair in two companies has one in each);
 *   - nothing else is touched, and running the move again changes nothing.
 */

const STRUCTURE = "20261024090000_chat_structure";
const MOVE = "20261024091000_chat_data_move";
const TRIGGER = "20261024092000_chat_realtime_trigger";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");

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

const run = (sql: string, ...values: unknown[]) => client.$executeRawUnsafe(sql, ...values);
const rows = <T = Record<string, unknown>>(sql: string, ...values: unknown[]) => client.$queryRawUnsafe<T[]>(sql, ...values);

// ---------- the old data set (columns the previous release knew) ----------

type Role = "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
type Status = "ACTIVE" | "SUSPENDED" | "OFFBOARDED";

const A = "orgA";
const B = "orgB";
const C = "orgC";
const NEW_ORG = "orgNew";

const U = {
  owner: "u_owner",
  admin: "u_admin",
  lead: "u_lead",
  m1: "u_m1",
  m2: "u_m2",
  m3: "u_m3",
  susp: "u_susp", // suspended
  off: "u_off", // offboarded
  guest: "u_guest", // external partner
  stranger: "u_stranger", // has an old group row but is not in any company
  z: "u_z", // with `ua` below: ids that sort differently with and without the C collation ("_" vs letters)
  a: "ua",
  ownerB: "u_ownerB",
  adminB: "u_adminB",
  ownerC: "u_ownerC",
} as const;

/** A person who only exists for the "created after the first run" scenario (not seeded). */
const NEWBIE = "u_newbie";

const ORG_MEMBERS: [org: string, user: string, role: Role, status: Status][] = [
  [A, U.owner, "OWNER", "ACTIVE"],
  [A, U.admin, "ADMIN", "ACTIVE"],
  [A, U.lead, "LEAD", "ACTIVE"],
  [A, U.m1, "MEMBER", "ACTIVE"],
  [A, U.m2, "MEMBER", "ACTIVE"],
  [A, U.m3, "MEMBER", "ACTIVE"],
  [A, U.susp, "MEMBER", "SUSPENDED"],
  [A, U.off, "MEMBER", "OFFBOARDED"],
  [A, U.guest, "GUEST", "ACTIVE"],
  [A, U.z, "MEMBER", "ACTIVE"],
  [A, U.a, "MEMBER", "ACTIVE"],
  [B, U.ownerB, "OWNER", "ACTIVE"],
  [B, U.adminB, "ADMIN", "ACTIVE"],
  [B, U.m1, "MEMBER", "ACTIVE"], // the same people work in two companies
  [B, U.m2, "MEMBER", "ACTIVE"],
  [C, U.ownerC, "OWNER", "ACTIVE"],
];

/** Spaces that existed before Phase 3 (written by people, with the slugs the app generates). */
const OLD_SPACES: [id: string, org: string, name: string, slug: string][] = [
  ["ws_old", A, "Main", "main-1a2b"],
  ["ws_user_hq", B, "HQ", "hq"], // a space of company B whose slug is the one the HQ wants
];
const OLD_SPACE_ROWS: [space: string, user: string, role: "ADMIN" | "MEMBER" | "GUEST"][] = [
  ["ws_old", U.owner, "ADMIN"],
  ["ws_old", U.m1, "MEMBER"],
  ["ws_old", U.guest, "GUEST"],
  ["ws_user_hq", U.m1, "ADMIN"],
];

const DEPARTMENTS: [id: string, org: string, name: string, emoji: string | null, leadId: string | null][] = [
  ["dept_design", A, "التصميم", "🎨", U.lead],
  ["dept_dev", A, "التطوير", null, U.admin], // the lead is not on the roster
  ["dept_empty", A, "فارغ", null, U.owner], // no roster; the lead is the owner
  ["dept_b", B, "قسم ب", "🧪", null],
];
const DEPARTMENT_ROWS: [dept: string, user: string, role: "lead" | "member"][] = [
  ["dept_design", U.lead, "lead"],
  ["dept_design", U.m1, "member"],
  ["dept_design", U.susp, "member"],
  ["dept_design", U.guest, "member"],
  ["dept_design", U.owner, "member"],
  ["dept_design", U.off, "member"],
  ["dept_dev", U.m2, "member"],
  ["dept_b", U.m1, "member"],
];

const CONVERSATIONS: [id: string, org: string, kind: "GROUP" | "DM", title: string | null, emoji: string | null, createdAt: string][] = [
  ["cv_g1", A, "GROUP", "فريق التصميم", "🎨", "2026-01-10 09:00:00"],
  ["cv_g2", A, "GROUP", "المبيعات", null, "2026-01-11 09:00:00"],
  ["cv_g3", A, "GROUP", "   ", "💼", "2026-01-12 09:00:00"], // a blank title
  ["cv_gb", B, "GROUP", "فريق ب", null, "2026-01-13 09:00:00"],
  // the pair (m1, m2) has three DMs; the OLDEST has the id that sorts last, so "oldest" cannot be "smallest id"
  ["cv_dm_z_old", A, "DM", null, null, "2026-02-01 08:00:00"],
  ["cv_dm_m_mid", A, "DM", null, null, "2026-03-01 08:00:00"],
  ["cv_dm_a_new", A, "DM", null, null, "2026-04-01 08:00:00"],
  // a tie on the creation time: the smaller id wins
  ["cv_dm_t2", A, "DM", null, null, "2026-02-15 10:00:00"],
  ["cv_dm_t1", A, "DM", null, null, "2026-02-15 10:00:00"],
  ["cv_dm_single", A, "DM", null, null, "2026-02-02 08:00:00"],
  ["cv_dm_owner", A, "DM", null, null, "2026-02-03 08:00:00"],
  ["cv_dm_susp", A, "DM", null, null, "2026-02-04 08:00:00"],
  ["cv_dm_collate", A, "DM", null, null, "2026-02-05 08:00:00"],
  ["cv_dm_one", A, "DM", null, null, "2026-02-06 08:00:00"], // broken: one person
  ["cv_dm_three", A, "DM", null, null, "2026-02-07 08:00:00"], // broken: three people
  ["cv_dm_b", B, "DM", null, null, "2026-02-08 08:00:00"], // the same pair as cv_dm_z_old, in the other company
];

const CONVERSATION_MEMBERS: [conv: string, user: string, role: "admin" | "member", lastReadAt: string][] = [
  ["cv_g1", U.m1, "admin", "2026-01-10 10:30:00"],
  ["cv_g1", U.m2, "member", "2026-01-10 10:05:00"],
  ["cv_g1", U.owner, "member", "2026-01-10 10:20:00"],
  ["cv_g1", U.guest, "member", "2026-01-10 09:10:00"],
  ["cv_g1", U.susp, "member", "2026-01-10 09:20:00"],
  ["cv_g1", U.off, "member", "2026-01-10 09:30:00"],
  ["cv_g1", U.stranger, "member", "2026-01-10 09:40:00"],
  ["cv_g2", U.m2, "member", "2026-01-11 09:30:00"],
  ["cv_g2", U.m3, "member", "2026-01-11 09:31:00"],
  ["cv_g3", U.admin, "admin", "2026-01-12 09:30:00"],
  ["cv_g3", U.m1, "member", "2026-01-12 09:31:00"],
  ["cv_gb", U.m1, "admin", "2026-01-13 09:30:00"],
  ["cv_gb", U.m2, "member", "2026-01-13 09:31:00"],
  ["cv_dm_z_old", U.m1, "member", "2026-02-01 08:30:00"],
  ["cv_dm_z_old", U.m2, "member", "2026-02-01 08:31:00"],
  ["cv_dm_m_mid", U.m1, "member", "2026-03-01 08:30:00"],
  ["cv_dm_m_mid", U.m2, "member", "2026-03-01 08:31:00"],
  ["cv_dm_a_new", U.m2, "member", "2026-04-01 08:30:00"],
  ["cv_dm_a_new", U.m1, "member", "2026-04-01 08:31:00"],
  ["cv_dm_t2", U.m3, "member", "2026-02-15 10:30:00"],
  ["cv_dm_t2", U.m2, "member", "2026-02-15 10:31:00"],
  ["cv_dm_t1", U.m2, "member", "2026-02-15 10:32:00"],
  ["cv_dm_t1", U.m3, "member", "2026-02-15 10:33:00"],
  ["cv_dm_single", U.admin, "member", "2026-02-02 08:30:00"],
  ["cv_dm_single", U.m1, "member", "2026-02-02 08:31:00"],
  ["cv_dm_owner", U.owner, "member", "2026-02-03 08:30:00"],
  ["cv_dm_owner", U.m1, "member", "2026-02-03 08:31:00"],
  ["cv_dm_susp", U.m1, "member", "2026-02-04 08:30:00"],
  ["cv_dm_susp", U.susp, "member", "2026-02-04 08:31:00"],
  ["cv_dm_collate", U.z, "member", "2026-02-05 08:30:00"],
  ["cv_dm_collate", U.a, "member", "2026-02-05 08:31:00"],
  ["cv_dm_one", U.m3, "member", "2026-02-06 08:30:00"],
  ["cv_dm_three", U.m1, "member", "2026-02-07 08:30:00"],
  ["cv_dm_three", U.m2, "member", "2026-02-07 08:31:00"],
  ["cv_dm_three", U.m3, "member", "2026-02-07 08:32:00"],
  ["cv_dm_b", U.m1, "member", "2026-02-08 08:30:00"],
  ["cv_dm_b", U.m2, "member", "2026-02-08 08:31:00"],
];

/** [id, org, conversation, author, body, replyTo, pinned, editedAt, deletedAt, createdAt] */
type MessageRow = [string, string, string, string, string, string | null, boolean, string | null, string | null, string];
const MESSAGES: MessageRow[] = [
  ["msg_g1_1", A, "cv_g1", U.m1, "أهلا بالفريق", null, false, null, null, "2026-01-10 10:00:00"],
  ["msg_g1_2", A, "cv_g1", U.m2, "أهلا فيك", "msg_g1_1", false, null, null, "2026-01-10 10:05:00"],
  ["msg_g1_3", A, "cv_g1", U.guest, "", null, false, null, "2026-01-10 10:10:00", "2026-01-10 10:08:00"], // deleted, body blanked by the old code
  ["msg_g1_4", A, "cv_g1", U.owner, "نص معدّل", null, true, "2026-01-10 10:16:00", null, "2026-01-10 10:15:00"],
  ["msg_g2_1", A, "cv_g2", U.m2, "عرض جديد", null, false, null, null, "2026-01-11 09:20:00"],
  ["msg_g3_1", A, "cv_g3", U.admin, "اجتماع غدا", null, false, null, null, "2026-01-12 09:20:00"],
  ["msg_gb_1", B, "cv_gb", U.m1, "صباح الخير", null, false, null, null, "2026-01-13 09:20:00"],
  ["msg_dm_old_1", A, "cv_dm_z_old", U.m1, "مرحبا", null, false, null, null, "2026-02-01 08:10:00"],
  ["msg_dm_old_2", A, "cv_dm_z_old", U.m2, "أهلا", "msg_dm_old_1", false, null, null, "2026-02-01 08:20:00"],
  ["msg_dm_mid_1", A, "cv_dm_m_mid", U.m2, "نسخة مكررة", null, false, null, null, "2026-03-01 08:10:00"],
  ["msg_dm_new_1", A, "cv_dm_a_new", U.m1, "ثالث", null, false, null, null, "2026-04-01 08:10:00"],
  ["msg_dm_owner_1", A, "cv_dm_owner", U.owner, "كيف الشغل", null, false, null, null, "2026-02-03 08:10:00"],
  ["msg_dm_b_1", B, "cv_dm_b", U.m2, "hello from B", null, false, null, null, "2026-02-08 08:10:00"],
];

const REACTIONS: [id: string, message: string, user: string, emoji: string][] = [
  ["rx_1", "msg_g1_1", U.m2, "👍"],
  ["rx_2", "msg_g1_1", U.owner, "❤️"],
  ["rx_3", "msg_dm_old_1", U.m2, "🔥"],
];

async function seedOldData(): Promise<void> {
  const orgIds = [A, B, C];
  for (const [i, org] of orgIds.entries()) {
    await run(
      `INSERT INTO "Organization" ("id","name","slug","keyPrefix","joinCode","updatedAt") VALUES ($1,$2,$3,$4,$5,now())`,
      org,
      `Company ${org}`,
      `slug-${org}`,
      `KP${i}`,
      `JOIN${i}AAA`,
    );
  }
  for (const id of Object.values(U)) {
    await run(
      `INSERT INTO "User" ("id","email","name","passwordHash","updatedAt") VALUES ($1,$2,$3,$4,now())`,
      id,
      `${id}@company.test`,
      `Name ${id}`,
      "$2a$12$abcdefghijklmnopqrstuuJ8m7wS3zKp1f0W7xQm2cZr1u9O2dE6S",
    );
  }
  for (const [org, user, role, status] of ORG_MEMBERS) {
    await run(
      `INSERT INTO "OrganizationMember" ("id","organizationId","userId","role","status","createdAt") VALUES ($1,$2,$3,$4::"OrgRole",$5::"MemberStatus",'2026-01-01'::timestamp)`,
      `om_${org}_${user}`,
      org,
      user,
      role,
      status,
    );
  }
  for (const [id, org, name, slug] of OLD_SPACES) {
    await run(`INSERT INTO "Workspace" ("id","organizationId","name","slug","updatedAt") VALUES ($1,$2,$3,$4,now())`, id, org, name, slug);
  }
  for (const [space, user, role] of OLD_SPACE_ROWS) {
    await run(`INSERT INTO "WorkspaceMember" ("id","workspaceId","userId","role") VALUES ($1,$2,$3,$4::"WorkspaceRole")`, `old_${space}_${user}`, space, user, role);
  }
  for (const [id, org, name, emoji, leadId] of DEPARTMENTS) {
    await run(`INSERT INTO "Department" ("id","orgId","name","emoji","leadId","createdAt") VALUES ($1,$2,$3,$4,$5,'2026-01-05'::timestamp)`, id, org, name, emoji, leadId);
  }
  for (const [dept, user, role] of DEPARTMENT_ROWS) {
    await run(`INSERT INTO "DepartmentMember" ("id","departmentId","userId","role") VALUES ($1,$2,$3,$4)`, `dm_${dept}_${user}`, dept, user, role);
  }
  for (const [id, org, kind, title, emoji, createdAt] of CONVERSATIONS) {
    await run(
      `INSERT INTO "Conversation" ("id","orgId","kind","title","emoji","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6::timestamp,$6::timestamp + interval '1 day')`,
      id,
      org,
      kind,
      title,
      emoji,
      createdAt,
    );
  }
  for (const [conv, user, role, lastReadAt] of CONVERSATION_MEMBERS) {
    await run(
      `INSERT INTO "ConversationMember" ("id","conversationId","userId","role","lastReadAt","joinedAt") VALUES ($1,$2,$3,$4,$5::timestamp,'2026-01-09 08:00:00'::timestamp)`,
      `cm_${conv}_${user}`,
      conv,
      user,
      role,
      lastReadAt,
    );
  }
  for (const [id, org, conv, author, body, replyTo, pinned, editedAt, deletedAt, createdAt] of MESSAGES) {
    await run(
      `INSERT INTO "ChatMessage" ("id","orgId","conversationId","authorId","body","replyToId","pinned","editedAt","deletedAt","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamp,$9::timestamp,$10::timestamp)`,
      id,
      org,
      conv,
      author,
      body,
      replyTo,
      pinned,
      editedAt,
      deletedAt,
      createdAt,
    );
  }
  for (const [id, message, user, emoji] of REACTIONS) {
    await run(`INSERT INTO "ChatReaction" ("id","messageId","userId","emoji") VALUES ($1,$2,$3,$4)`, id, message, user, emoji);
  }
  await run(
    `INSERT INTO "StoredFile" ("id","orgId","uploaderId","familyId","name","path","mimeType","size") VALUES ('f_old',$1,$2,'f_old','plan.pdf','files/f_old','application/pdf',1234)`,
    A,
    U.m1,
  );
  await run(`INSERT INTO "AuditLog" ("id","orgId","action") VALUES ('al_old',$1,'org.created')`, A);
}

// ---------- snapshots ----------

/** The columns the previous release knew, per table: what must come out of the move exactly as it went in. */
const OLD = {
  ChatMessage: `SELECT "id","orgId","conversationId","authorId","body","replyToId","pinned","editedAt","deletedAt","createdAt" FROM "ChatMessage" ORDER BY "id"`,
  ConversationMember: `SELECT "id","conversationId","userId","role","lastReadAt","joinedAt" FROM "ConversationMember" ORDER BY "id"`,
  ChatReaction: `SELECT "id","messageId","userId","emoji" FROM "ChatReaction" ORDER BY "id"`,
  Organization: `SELECT "id","name","slug","keyPrefix","joinCode","timezone","settings","createdAt","updatedAt" FROM "Organization" ORDER BY "id"`,
  User: `SELECT "id","email","name","passwordHash","tokenVersion","createdAt","updatedAt" FROM "User" ORDER BY "id"`,
  OrganizationMember: `SELECT "id","organizationId","userId","role"::text AS role,"status"::text AS status,"createdAt" FROM "OrganizationMember" ORDER BY "id"`,
  Department: `SELECT "id","orgId","name","emoji","leadId","createdAt" FROM "Department" ORDER BY "id"`,
  DepartmentMember: `SELECT "id","departmentId","userId","role","createdAt" FROM "DepartmentMember" ORDER BY "id"`,
  AuditLog: `SELECT "id","actorId","orgId","action","target","createdAt" FROM "AuditLog" ORDER BY "id"`,
  // the old rows only (the move adds new ones to these two)
  Workspace: `SELECT "id","organizationId","name","slug","description","createdAt","updatedAt" FROM "Workspace" WHERE "id" IN ('ws_old','ws_user_hq') ORDER BY "id"`,
  WorkspaceMember: `SELECT "id","workspaceId","userId","role"::text AS role,"createdAt" FROM "WorkspaceMember" WHERE "id" LIKE 'old\\_%' ORDER BY "id"`,
  // DMs are untouched except for the key (checked on its own)
  DirectMessages: `SELECT "id","orgId","kind","title","emoji","createdAt","updatedAt" FROM "Conversation" WHERE "kind" = 'DM' ORDER BY "id"`,
  // the groups keep their identity: only kind, title and emoji are rewritten (checked on their own)
  GroupIdentity: `SELECT "id","orgId","createdAt","updatedAt" FROM "Conversation" WHERE "id" IN ('cv_g1','cv_g2','cv_g3','cv_gb') ORDER BY "id"`,
} as const;

/** Every column the schema has after Phase 3, for the "run it twice" comparison. */
const FULL = {
  Workspace: `SELECT "id","organizationId","name","slug","description","kind"::text AS kind,"emoji","systemKey","departmentId","createdAt","updatedAt" FROM "Workspace" ORDER BY "id"`,
  WorkspaceMember: `SELECT "id","workspaceId","userId","role"::text AS role,"createdAt","mutedUntil" FROM "WorkspaceMember" ORDER BY "id"`,
  Conversation: `SELECT "id","orgId","kind","title","emoji","createdAt","updatedAt","spaceId","topicType","postingPolicy","restricted","closedAt","position","systemKey","dmKey" FROM "Conversation" ORDER BY "id"`,
  ConversationMember: `SELECT "id","conversationId","userId","role","lastReadAt","joinedAt","lastDeliveredAt","mutedUntil" FROM "ConversationMember" ORDER BY "id"`,
  ChatMessage: `SELECT "id","orgId","conversationId","authorId","body","replyToId","pinned","editedAt","deletedAt","createdAt","kind","deletedById","forwardedFromId","mentions","clientId" FROM "ChatMessage" ORDER BY "id"`,
  ChatReaction: OLD.ChatReaction,
  StoredFile: `SELECT "id","orgId","name","purpose" FROM "StoredFile" ORDER BY "id"`,
  AuditLog: OLD.AuditLog,
} as const;

async function snapshot(queries: Record<string, string>): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [name, sql] of Object.entries(queries)) out[name] = await rows(sql);
  return out;
}

let before: Record<string, unknown[]> = {};
let afterStructure: {
  workspaces: { id: string; kind: string; emoji: string | null; systemKey: string | null; departmentId: string | null }[];
  conversations: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  members: Record<string, unknown>[];
  files: { purpose: string }[];
  users: { lastSeenAt: Date | null }[];
};
let after: Record<string, unknown[]> = {};
let afterFull: Record<string, unknown[]> = {};

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
  dbName = `zaki_p3_move_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const url = new URL(adminUrl.toString());
  url.pathname = `/${dbName}`;
  scratchUrl = url.toString();
  const root = new PrismaClient({ datasourceUrl: adminUrl.toString(), log: [] });
  try {
    await root.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await root.$disconnect();
  }

  tmp = mkdtempSync(path.join(os.tmpdir(), "p3-chat-move-"));
  mkdirSync(path.join(tmp, "migrations"));
  copyFileSync(path.join(ROOT, "prisma", "schema.prisma"), path.join(tmp, "schema.prisma"));
  copyFileSync(path.join(MIGRATIONS, "migration_lock.toml"), path.join(tmp, "migrations", "migration_lock.toml"));
  const older = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name < STRUCTURE)
    .map((d) => d.name);
  for (const name of older) copyMigration(name);
  deploy(); // the database as production has it today

  client = new PrismaClient({ datasourceUrl: scratchUrl, log: ["error"] });
  await seedOldData();
  before = await snapshot(OLD);

  copyMigration(STRUCTURE);
  deploy(); // step 1: structure only
  afterStructure = {
    workspaces: await rows(`SELECT "id","kind"::text AS kind,"emoji","systemKey","departmentId" FROM "Workspace" ORDER BY "id"`),
    conversations: await rows(`SELECT "id","spaceId","topicType","postingPolicy","restricted","closedAt","position","systemKey","dmKey" FROM "Conversation" ORDER BY "id"`),
    messages: await rows(`SELECT DISTINCT "kind","mentions","deletedById","forwardedFromId","clientId" FROM "ChatMessage"`),
    members: await rows(`SELECT DISTINCT "lastDeliveredAt","mutedUntil" FROM "ConversationMember"`),
    files: await rows(`SELECT DISTINCT "purpose" FROM "StoredFile"`),
    users: await rows(`SELECT DISTINCT "lastSeenAt" FROM "User"`),
  };

  copyMigration(MOVE);
  copyMigration(TRIGGER);
  deploy(); // steps 2 and 3: the data move and the trigger
  after = await snapshot(OLD);
  afterFull = await snapshot(FULL);
}, 300_000);

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

// ---------- helpers for the assertions ----------

const spaceMembers = async (spaceId: string): Promise<[string, string][]> =>
  (
    await rows<{ userId: string; role: string }>(
      `SELECT "userId","role"::text AS role FROM "WorkspaceMember" WHERE "workspaceId"=$1 ORDER BY "userId" COLLATE "C"`,
      spaceId,
    )
  ).map((r) => [r.userId, r.role]);

const sorted = (list: [string, string][]): [string, string][] => [...list].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

/** The key the code builds for a pair of people: the smaller id first (plain code-unit order), a bar between. */
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const TOPICS = [
  { key: "announcements", title: "التنبيهات", emoji: "📢", topicType: "ANNOUNCEMENTS", postingPolicy: "ADMINS", restricted: false, position: 0 },
  { key: "followup", title: "المتابعة", emoji: "🔁", topicType: "FOLLOWUP", postingPolicy: "ADMINS", restricted: false, position: 1 },
  { key: "general", title: "عام", emoji: "💬", topicType: "DISCUSSION", postingPolicy: "ALL", restricted: false, position: 2 },
  { key: "ideas", title: "الأفكار", emoji: "💡", topicType: "IDEAS", postingPolicy: "ALL", restricted: false, position: 3 },
  { key: "archive", title: "الأرشيف", emoji: "🗄️", topicType: "DISCUSSION", postingPolicy: "ALL", restricted: true, position: 4 },
] as const;

// ---------- the structure migration on existing rows ----------

describe("the structure migration, on rows that already exist", () => {
  it("applied: the three Phase 3 migrations are recorded as finished", async () => {
    const applied = await rows<{ migration_name: string; finished_at: Date | null }>(
      `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name = ANY($1)`,
      [STRUCTURE, MOVE, TRIGGER],
    );
    expect(applied.map((m) => m.migration_name).sort()).toEqual([STRUCTURE, MOVE, TRIGGER].sort());
    expect(applied.every((m) => m.finished_at !== null)).toBe(true);
  });

  it("gives every existing row a safe default and fills nothing else (no key, no space, no mute, nothing read as delivered)", () => {
    expect(afterStructure.workspaces).toHaveLength(OLD_SPACES.length);
    for (const w of afterStructure.workspaces) expect(w, w.id).toMatchObject({ kind: "STANDARD", emoji: null, systemKey: null, departmentId: null });
    expect(afterStructure.conversations).toHaveLength(CONVERSATIONS.length);
    for (const c of afterStructure.conversations) {
      expect(c, String(c["id"])).toMatchObject({ spaceId: null, topicType: "DISCUSSION", postingPolicy: "ALL", restricted: false, closedAt: null, position: 0, systemKey: null, dmKey: null });
    }
    expect(afterStructure.messages).toEqual([{ kind: "TEXT", mentions: [], deletedById: null, forwardedFromId: null, clientId: null }]);
    expect(afterStructure.members).toEqual([{ lastDeliveredAt: null, mutedUntil: null }]);
    expect(afterStructure.files).toEqual([{ purpose: "LIBRARY" }]);
    expect(afterStructure.users).toEqual([{ lastSeenAt: null }]);
  });
});

// ---------- HQ ----------

describe("HQ: one space per company, with five topics", () => {
  it("every company has its HQ space with the fixed id, name, emoji and key (and a slug of its own when the plain one is taken)", async () => {
    const hq = await rows<Record<string, unknown>>(
      `SELECT "id","organizationId","name","slug","kind"::text AS kind,"emoji","systemKey","departmentId","description" FROM "Workspace" WHERE "id" LIKE 'ws\\_hq\\_%' ORDER BY "id"`,
    );
    const base = { name: "المقر", kind: "HQ", emoji: "🕌", systemKey: "hq", departmentId: null, description: null };
    expect(hq).toEqual([
      { ...base, id: `ws_hq_${A}`, organizationId: A, slug: "hq" },
      // company B already has a space of its own whose slug is "hq": the HQ takes a deterministic other one
      { ...base, id: `ws_hq_${B}`, organizationId: B, slug: `hq-${B}` },
      { ...base, id: `ws_hq_${C}`, organizationId: C, slug: "hq" },
    ]);
  });

  it("holds every ACTIVE member who is not the owner and not a guest: an ADMIN is its ADMIN, everybody else a MEMBER", async () => {
    expect(await spaceMembers(`ws_hq_${A}`)).toEqual(
      sorted([
        [U.admin, "ADMIN"],
        [U.lead, "MEMBER"],
        [U.m1, "MEMBER"],
        [U.m2, "MEMBER"],
        [U.m3, "MEMBER"],
        [U.z, "MEMBER"],
        [U.a, "MEMBER"],
      ]),
    );
    expect(await spaceMembers(`ws_hq_${B}`)).toEqual(
      sorted([
        [U.adminB, "ADMIN"],
        [U.m1, "MEMBER"],
        [U.m2, "MEMBER"],
      ]),
    );
    expect(await spaceMembers(`ws_hq_${C}`)).toEqual([]); // a company with only its owner: HQ exists, nobody is in it
  });

  it("has the five topics, each with its fixed id, title, type, posting rule and order - and no member rows at all", async () => {
    for (const org of [A, B, C]) {
      const topics = await rows<Record<string, unknown>>(
        `SELECT "id","orgId","kind","title","emoji","spaceId","topicType","postingPolicy","restricted","closedAt","position","systemKey","dmKey"
         FROM "Conversation" WHERE "spaceId"=$1 ORDER BY "position"`,
        `ws_hq_${org}`,
      );
      expect(topics).toEqual(
        TOPICS.map((t) => ({
          id: `cv_hq_${t.key}_${org}`,
          orgId: org,
          kind: "TOPIC",
          title: t.title,
          emoji: t.emoji,
          spaceId: `ws_hq_${org}`,
          topicType: t.topicType,
          postingPolicy: t.postingPolicy,
          restricted: t.restricted,
          closedAt: null,
          position: t.position,
          systemKey: t.key,
          dmKey: null,
        })),
      );
      const withRows = await rows<{ n: bigint }>(`SELECT count(*) AS n FROM "ConversationMember" WHERE "conversationId" LIKE $1`, `cv\\_hq\\_%\\_${org}`);
      expect(withRows[0]?.n, `no ConversationMember row in the HQ topics of ${org}`).toBe(0n);
    }
  });
});

// ---------- departments ----------

describe("departments: one space each, with its people and a general topic", () => {
  it("creates the space with the department's name and emoji, its key and a slug of its own", async () => {
    const spaces = await rows<Record<string, unknown>>(
      `SELECT "id","organizationId","name","slug","kind"::text AS kind,"emoji","systemKey","departmentId" FROM "Workspace" WHERE "id" LIKE 'ws\\_dept\\_%' ORDER BY "id"`,
    );
    expect(spaces).toEqual(
      DEPARTMENTS.map(([id, org, name, emoji]) => ({
        id: `ws_dept_${id}`,
        organizationId: org,
        name,
        slug: `dept-${id}`,
        kind: "DEPARTMENT",
        emoji,
        systemKey: null,
        departmentId: id,
      })).sort((x, y) => (x.id < y.id ? -1 : 1)),
    );
  });

  it("puts in it the department's ACTIVE non-guest people (never the owner, never a suspended or offboarded person); the lead is the space ADMIN, as DepartmentMember role or as Department.leadId", async () => {
    expect(await spaceMembers("ws_dept_dept_design")).toEqual(
      sorted([
        [U.lead, "ADMIN"],
        [U.m1, "MEMBER"],
      ]),
    );
    expect(await spaceMembers("ws_dept_dept_dev")).toEqual(
      sorted([
        [U.admin, "ADMIN"], // named as the department's lead although not on its roster
        [U.m2, "MEMBER"],
      ]),
    );
    expect(await spaceMembers("ws_dept_dept_empty")).toEqual([]); // the owner leads it and needs no row
    expect(await spaceMembers("ws_dept_dept_b")).toEqual([[U.m1, "MEMBER"]]);
  });

  it("gives each one a general topic with a fixed id, open to everybody in the space", async () => {
    for (const [id, org] of DEPARTMENTS) {
      const topics = await rows<Record<string, unknown>>(
        `SELECT "id","orgId","kind","title","emoji","spaceId","topicType","postingPolicy","restricted","closedAt","position","systemKey" FROM "Conversation" WHERE "spaceId"=$1`,
        `ws_dept_${id}`,
      );
      expect(topics).toEqual([
        {
          id: `cv_dept_${id}`,
          orgId: org,
          kind: "TOPIC",
          title: "عام",
          emoji: "💬",
          spaceId: `ws_dept_${id}`,
          topicType: "DISCUSSION",
          postingPolicy: "ALL",
          restricted: false,
          closedAt: null,
          position: 0,
          systemKey: "general",
        },
      ]);
    }
  });
});

// ---------- legacy groups ----------

describe("legacy groups: a space whose people are the group's people, and the group is its general topic", () => {
  it("creates a STANDARD space named like the group (a blank title becomes a plain name), with its emoji and a slug of its own", async () => {
    const spaces = await rows<Record<string, unknown>>(
      `SELECT "id","organizationId","name","slug","kind"::text AS kind,"emoji","systemKey","departmentId" FROM "Workspace" WHERE "id" LIKE 'ws\\_grp\\_%' ORDER BY "id"`,
    );
    expect(spaces).toEqual([
      { id: "ws_grp_cv_g1", organizationId: A, name: "فريق التصميم", slug: "grp-cv_g1", kind: "STANDARD", emoji: "🎨", systemKey: null, departmentId: null },
      { id: "ws_grp_cv_g2", organizationId: A, name: "المبيعات", slug: "grp-cv_g2", kind: "STANDARD", emoji: null, systemKey: null, departmentId: null },
      { id: "ws_grp_cv_g3", organizationId: A, name: "مجموعة", slug: "grp-cv_g3", kind: "STANDARD", emoji: "💼", systemKey: null, departmentId: null },
      { id: "ws_grp_cv_gb", organizationId: B, name: "فريق ب", slug: "grp-cv_gb", kind: "STANDARD", emoji: null, systemKey: null, departmentId: null },
    ]);
  });

  it("keeps the group's ACTIVE non-guest people (group admin -> space ADMIN, others MEMBER); the owner, the guest, the suspended, the offboarded and the stranger get no space row", async () => {
    expect(await spaceMembers("ws_grp_cv_g1")).toEqual(
      sorted([
        [U.m1, "ADMIN"],
        [U.m2, "MEMBER"],
      ]),
    );
    expect(await spaceMembers("ws_grp_cv_g2")).toEqual(
      sorted([
        [U.m2, "MEMBER"],
        [U.m3, "MEMBER"],
      ]),
    ); // a group without an admin stays without one: the owner moderates it
    expect(await spaceMembers("ws_grp_cv_g3")).toEqual(
      sorted([
        [U.admin, "ADMIN"],
        [U.m1, "MEMBER"],
      ]),
    );
    expect(await spaceMembers("ws_grp_cv_gb")).toEqual(
      sorted([
        [U.m1, "ADMIN"],
        [U.m2, "MEMBER"],
      ]),
    );
  });

  it("turns the conversation itself into the general topic of that space: same id, same messages, same people, same read marks", async () => {
    const topics = await rows<Record<string, unknown>>(
      `SELECT "id","orgId","kind","title","emoji","spaceId","topicType","postingPolicy","restricted","closedAt","position","systemKey","dmKey"
       FROM "Conversation" WHERE "id" IN ('cv_g1','cv_g2','cv_g3','cv_gb') ORDER BY "id"`,
    );
    expect(topics).toEqual(
      [
        ["cv_g1", A],
        ["cv_g2", A],
        ["cv_g3", A],
        ["cv_gb", B],
      ].map(([id, org]) => ({
        id,
        orgId: org,
        kind: "TOPIC",
        title: "عام",
        emoji: "💬",
        spaceId: `ws_grp_${id}`,
        topicType: "DISCUSSION",
        postingPolicy: "ALL",
        restricted: false,
        closedAt: null,
        position: 0,
        systemKey: "general",
        dmKey: null,
      })),
    );
    // nothing is left of the legacy kind
    expect(await rows(`SELECT 1 AS one FROM "Conversation" WHERE "kind"='GROUP'`)).toHaveLength(0);
    // the people of the old group keep their conversation rows (the owner's too: he did take part), whatever their status
    const g1 = await rows<{ userId: string }>(`SELECT "userId" FROM "ConversationMember" WHERE "conversationId"='cv_g1' ORDER BY "userId" COLLATE "C"`);
    expect(g1.map((r) => r.userId)).toEqual([U.guest, U.m1, U.m2, U.off, U.owner, U.stranger, U.susp].sort());
  });
});

// ---------- DMs ----------

describe("DMs: only the OLDEST of a pair gets its key", () => {
  const keys = async () => {
    const list = await rows<{ id: string; orgId: string; dmKey: string | null }>(`SELECT "id","orgId","dmKey" FROM "Conversation" WHERE "kind"='DM' ORDER BY "id"`);
    return new Map(list.map((r) => [r.id, r.dmKey]));
  };

  it("keys the oldest DM of each pair (smaller user id first), leaves the duplicates without one, and decides a tie by id", async () => {
    const k = await keys();
    expect(k.get("cv_dm_z_old")).toBe(pairKey(U.m1, U.m2)); // the oldest, although its id sorts last
    expect(k.get("cv_dm_m_mid")).toBeNull();
    expect(k.get("cv_dm_a_new")).toBeNull();
    expect(k.get("cv_dm_t1")).toBe(pairKey(U.m2, U.m3)); // same time as cv_dm_t2: the smaller id
    expect(k.get("cv_dm_t2")).toBeNull();
    expect(k.get("cv_dm_single")).toBe(pairKey(U.admin, U.m1));
    expect(k.get("cv_dm_owner")).toBe(pairKey(U.owner, U.m1)); // the owner's own DMs are ordinary DMs
    expect(k.get("cv_dm_susp")).toBe(pairKey(U.m1, U.susp)); // the key says who the pair is, not whether they are active
  });

  it("builds the key like the code does, with plain code-unit order of the ids (not the database's language rules)", async () => {
    const k = await keys();
    expect(U.z < U.a).toBe(true); // "u_z" < "ua": the underscore sorts before letters in code-unit order
    expect(k.get("cv_dm_collate")).toBe("u_z|ua");
  });

  it("never keys a broken DM (one person, or three)", async () => {
    const k = await keys();
    expect(k.get("cv_dm_one")).toBeNull();
    expect(k.get("cv_dm_three")).toBeNull();
  });

  it("keys the same pair once PER COMPANY: a person can work in two companies, each with its own DM", async () => {
    const k = await keys();
    expect(k.get("cv_dm_b")).toBe(pairKey(U.m1, U.m2));
    expect(k.get("cv_dm_z_old")).toBe(pairKey(U.m1, U.m2));
  });

  it("leaves no pair with two keyed DMs in one company", async () => {
    const dup = await rows(`SELECT "orgId","dmKey",count(*) FROM "Conversation" WHERE "dmKey" IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1`);
    expect(dup).toEqual([]);
  });

  it("makes a second DM for a keyed pair impossible from now on", async () => {
    // (Prisma reports the code and the columns of the key, not the name of the index)
    await expect(
      run(`INSERT INTO "Conversation" ("id","orgId","kind","dmKey","updatedAt") VALUES ('cv_race',$1,'DM',$2,now())`, A, pairKey(U.m1, U.m2)),
    ).rejects.toThrow(/23505[\s\S]*Key \("?orgId"?, "?dmKey"?\)=/);
  });
});

// ---------- the rules that hold everywhere ----------

describe("rules that hold for everything the move created", () => {
  const created = `("id" LIKE 'ws\\_hq\\_%' OR "id" LIKE 'ws\\_dept\\_%' OR "id" LIKE 'ws\\_grp\\_%')`;

  it("the owner has no space row anywhere in what it created (he reads without one)", async () => {
    const owners = [U.owner, U.ownerB, U.ownerC];
    const found = await rows(
      `SELECT "workspaceId","userId" FROM "WorkspaceMember" WHERE "userId" = ANY($1) AND "workspaceId" IN (SELECT "id" FROM "Workspace" WHERE ${created})`,
      owners,
    );
    expect(found).toEqual([]);
  });

  it("every person it put in a space is an ACTIVE member of that space's company who is neither the owner nor a guest, and nobody is a space GUEST", async () => {
    const bad = await rows(
      `SELECT wm."id" FROM "WorkspaceMember" wm
       JOIN "Workspace" w ON w."id" = wm."workspaceId"
       LEFT JOIN "OrganizationMember" om ON om."organizationId" = w."organizationId" AND om."userId" = wm."userId"
       WHERE wm."id" LIKE 'wm\\_p3\\_%'
         AND (om."id" IS NULL OR om."status" <> 'ACTIVE' OR om."role" IN ('OWNER','GUEST') OR wm."role" = 'GUEST')`,
    );
    expect(bad).toEqual([]);
    const guestSpaces = await rows(`SELECT "workspaceId" FROM "WorkspaceMember" WHERE "userId"=$1 AND "workspaceId" IN (SELECT "id" FROM "Workspace" WHERE ${created})`, U.guest);
    expect(guestSpaces).toEqual([]); // not in HQ, not in a department space, not in a converted group
  });

  it("no slug is used twice inside a company, and the old spaces kept theirs", async () => {
    const dup = await rows(`SELECT "organizationId","slug",count(*) FROM "Workspace" GROUP BY 1,2 HAVING count(*) > 1`);
    expect(dup).toEqual([]);
    const old = await rows(`SELECT "id","slug" FROM "Workspace" WHERE "id" IN ('ws_old','ws_user_hq') ORDER BY "id"`);
    expect(old).toEqual([
      { id: "ws_old", slug: "main-1a2b" },
      { id: "ws_user_hq", slug: "hq" },
    ]);
  });

  it("created exactly what the plan says and nothing more", async () => {
    const [spaces] = await rows<{ n: bigint }>(`SELECT count(*) AS n FROM "Workspace"`);
    expect(spaces?.n).toBe(BigInt(OLD_SPACES.length + 3 + DEPARTMENTS.length + 4));
    const [topics] = await rows<{ n: bigint }>(`SELECT count(*) AS n FROM "Conversation" WHERE "kind"='TOPIC'`);
    expect(topics?.n).toBe(BigInt(3 * TOPICS.length + DEPARTMENTS.length + 4));
    // every topic lives in a space of its own company
    const stray = await rows(
      `SELECT c."id" FROM "Conversation" c JOIN "Workspace" w ON w."id" = c."spaceId" WHERE c."kind"='TOPIC' AND c."orgId" <> w."organizationId"`,
    );
    expect(stray).toEqual([]);
  });
});

// ---------- nothing else changed ----------

describe("nothing else is touched", () => {
  it("every old message, reaction, read mark, person, company, membership, department and audit row is exactly as it was", () => {
    for (const table of ["ChatMessage", "ConversationMember", "ChatReaction", "Organization", "User", "OrganizationMember", "Department", "DepartmentMember", "AuditLog"] as const) {
      expect(after[table], table).toEqual(before[table]);
    }
  });

  it("the old spaces and their rows are as they were (the owner's old row stays; the move adds none for him)", () => {
    expect(after["Workspace"]).toEqual(before["Workspace"]);
    expect(after["WorkspaceMember"]).toEqual(before["WorkspaceMember"]);
  });

  it("the DMs are as they were (their key is the only thing that was filled), and a converted group keeps its id and dates", () => {
    expect(after["DirectMessages"]).toEqual(before["DirectMessages"]);
    expect(after["GroupIdentity"]).toEqual(before["GroupIdentity"]);
  });

  it("the pre-move content is complete: all messages are still in their conversations, the deleted ones included", async () => {
    const perConversation = await rows<{ conversationId: string; n: bigint }>(`SELECT "conversationId", count(*) AS n FROM "ChatMessage" GROUP BY 1 ORDER BY 1`);
    const expected = new Map<string, number>();
    for (const m of MESSAGES) expected.set(m[2], (expected.get(m[2]) ?? 0) + 1);
    expect(new Map(perConversation.map((r) => [r.conversationId, Number(r.n)]))).toEqual(expected);
    const deleted = await rows<{ id: string; body: string; deletedAt: Date | null }>(`SELECT "id","body","deletedAt" FROM "ChatMessage" WHERE "id"='msg_g1_3'`);
    expect(deleted[0]?.deletedAt).not.toBeNull();
  });
});

// ---------- repeatable ----------

/** The statements of the data move, cut the way the migration linter reads them (a `;` inside a string does not split). */
function moveStatements(): string[] {
  const sql = readFileSync(path.join(MIGRATIONS, MOVE, "migration.sql"), "utf8");
  return sqlStatements(sql)
    .map((s) => s.code.trim())
    .filter(Boolean);
}

describe("the data move is safe to run again", () => {
  it("running every statement a second time changes nothing at all (ids, members, titles, keys, dates)", async () => {
    for (const statement of moveStatements()) await run(statement);
    const second = await snapshot(FULL);
    for (const table of Object.keys(FULL)) expect(second[table], table).toEqual(afterFull[table]);
    const old = await snapshot(OLD);
    expect(old).toEqual(after);
  });

  it("and it completes what a newer company or a late legacy group still needs - the same ids the application uses for HQ", async () => {
    // a company and a group created after the first run (for instance by the previous release, still running during the deploy)
    await run(`INSERT INTO "Organization" ("id","name","slug","keyPrefix","joinCode","updatedAt") VALUES ($1,'New co','slug-new','KPN','JOINNEWA',now())`, NEW_ORG);
    await run(`INSERT INTO "User" ("id","email","name","passwordHash","updatedAt") VALUES ($1,'newbie@company.test','Newbie','x',now())`, NEWBIE);
    await run(`INSERT INTO "OrganizationMember" ("id","organizationId","userId","role","status") VALUES ('om_new_1',$1,$2,'ADMIN'::"OrgRole",'ACTIVE'::"MemberStatus")`, NEW_ORG, NEWBIE);
    await run(
      `INSERT INTO "Conversation" ("id","orgId","kind","title","emoji","updatedAt") VALUES ('cv_overlap_group',$1,'GROUP','متأخرة','🕰️',now())`,
      NEW_ORG,
    );
    await run(`INSERT INTO "ConversationMember" ("id","conversationId","userId","role") VALUES ('cm_overlap_1','cv_overlap_group',$1,'admin')`, NEWBIE);
    const untouched = await snapshot(FULL);

    for (const statement of moveStatements()) await run(statement);

    expect(await spaceMembers(`ws_hq_${NEW_ORG}`)).toEqual([[NEWBIE, "ADMIN"]]);
    const topics = await rows<{ id: string; systemKey: string }>(`SELECT "id","systemKey" FROM "Conversation" WHERE "spaceId"=$1 ORDER BY "position"`, `ws_hq_${NEW_ORG}`);
    expect(topics.map((t) => t.id)).toEqual(TOPICS.map((t) => `cv_hq_${t.key}_${NEW_ORG}`));
    expect(await spaceMembers("ws_grp_cv_overlap_group")).toEqual([[NEWBIE, "ADMIN"]]);
    expect(
      (await rows<{ kind: string; title: string; systemKey: string; spaceId: string }>(`SELECT "kind","title","systemKey","spaceId" FROM "Conversation" WHERE "id"='cv_overlap_group'`))[0],
    ).toEqual({
      kind: "TOPIC",
      title: "عام",
      systemKey: "general",
      spaceId: "ws_grp_cv_overlap_group",
    });

    // and everything that existed is exactly as before: only rows of the new company and the late group were added
    const now = await snapshot(FULL);
    for (const table of ["ChatMessage", "ChatReaction", "StoredFile", "AuditLog"] as const) expect(now[table], table).toEqual(untouched[table]);
    const without = (list: unknown[], skip: (row: Record<string, unknown>) => boolean) => (list as Record<string, unknown>[]).filter((r) => !skip(r));
    const isNew = (id: unknown) => typeof id === "string" && (id.endsWith(NEW_ORG) || id.includes("overlap"));
    expect(without(now["Workspace"]!, (r) => isNew(r["id"]))).toEqual(untouched["Workspace"]);
    expect(without(now["WorkspaceMember"]!, (r) => isNew(r["workspaceId"]))).toEqual(untouched["WorkspaceMember"]);
    expect(without(now["Conversation"]!, (r) => isNew(r["id"]))).toEqual(without(untouched["Conversation"]!, (r) => isNew(r["id"])));
  });
});
