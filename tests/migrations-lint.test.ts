import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashMigrationSql, lintMigrations, sqlStatements, sqlViews } from "../scripts/lint-migrations.mjs";

vi.setConfig({ testTimeout: 30_000 });

const SCRIPT = resolve(__dirname, "../scripts/lint-migrations.mjs");
const REAL = resolve(__dirname, "../prisma/migrations");

/** Every migration folder that existed on 2026-10-22. None of them may ever be renamed or removed. */
const HISTORY = [
  "20261016192059_init",
  "20261017080000_accounts_ideas_profiles",
  "20261017090000_integrations",
  "20261017100000_event_optional_link",
  "20261017113000_internal_chat",
  "20261017121500_file_library",
  "20261017123000_departments",
  "20261017123500_it_tickets",
  "20261017130000_production_goals",
  "20261019120000_crm_models",
  "20261019190000_ticket_comments_activity",
  "20261019200000_campaign_calendar",
];

const OK_SQL = 'CREATE TABLE "Thing" (\n  "id" TEXT NOT NULL,\n  CONSTRAINT "Thing_pkey" PRIMARY KEY ("id")\n);\n';
const ZEROS = "0".repeat(64);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

interface Fixture {
  /** folder name -> migration.sql content (omit the file with null). */
  folders: Record<string, string | Buffer | null>;
  /**
   * RELEASED.txt lines; null = no file. Default: every folder in `folders`.
   * A bare folder name is written WITH the sha256 of that folder's file (or of nothing, if the folder
   * is not in the fixture); a line with a space in it, a comment or a blank line is written as it is.
   */
  released?: string[] | null;
  allowed?: string[];
  /** migration_lock.toml; null = no file. */
  lock?: string | null;
}

/** `name sha256:<hash of its migration.sql>` - the line RELEASED.txt wants. */
function pin(name: string, sql: string | Buffer | null | undefined): string {
  const hash = sql === null || sql === undefined ? ZEROS : hashMigrationSql(Buffer.isBuffer(sql) ? sql : Buffer.from(sql));
  return `${name} sha256:${hash}`;
}

function build(f: Fixture): string {
  const dir = mkdtempSync(join(tmpdir(), "zaki-mig-"));
  dirs.push(dir);
  for (const [name, sql] of Object.entries(f.folders)) {
    mkdirSync(join(dir, name));
    if (sql !== null) writeFileSync(join(dir, name, "migration.sql"), sql);
  }
  const lock = f.lock === undefined ? 'provider = "postgresql"\n' : f.lock;
  if (lock !== null) writeFileSync(join(dir, "migration_lock.toml"), lock);
  const released = f.released === undefined ? Object.keys(f.folders) : f.released;
  if (released !== null) {
    const lines = released.map((line) => (/\s|^#|^$/.test(line) ? line : pin(line, f.folders[line])));
    writeFileSync(join(dir, "RELEASED.txt"), `${lines.join("\n")}\n`);
  }
  if (f.allowed) writeFileSync(join(dir, "ALLOWED_DESTRUCTIVE.txt"), `${f.allowed.join("\n")}\n`);
  return dir;
}

const rules = (dir: string) => lintMigrations(dir).problems.map((p) => p.rule).sort();

const INIT = "20260101000000_init";
const CHANGE = "20260102000000_change";

/** The problems found in a NEW (not yet released) migration holding this SQL. */
function newMigration(sql: string, extra: Partial<Fixture> = {}) {
  const dir = build({ folders: { [INIT]: OK_SQL, [CHANGE]: sql }, released: [INIT], ...extra });
  return lintMigrations(dir).problems;
}

describe("the real prisma/migrations folder", () => {
  it("passes every rule", () => {
    const result = lintMigrations(REAL);
    expect(result.problems).toEqual([]);
  });

  it("RELEASED.txt still names all 12 folders that existed on 2026-10-22, and every one still exists", () => {
    const listed = readFileSync(join(REAL, "RELEASED.txt"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim().split(/\s+/)[0] ?? "")
      .filter(Boolean);
    for (const name of HISTORY) {
      expect(listed, `${name} must stay listed in RELEASED.txt`).toContain(name);
      expect(existsSync(join(REAL, name, "migration.sql")), `${name} must still exist`).toBe(true);
    }
  });

  it("every released folder is pinned to the sha256 of its SQL, and the pin still matches", () => {
    const lines = readFileSync(join(REAL, "RELEASED.txt"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(HISTORY.length);
    for (const line of lines) {
      const [name, token, ...rest] = line.split(/\s+/) as [string, string | undefined, ...string[]];
      expect(rest, `${name}: nothing after the pin`).toEqual([]);
      expect(token, `${name} needs a sha256 pin`).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(token, `${name}: the SQL changed after it was released`).toBe(`sha256:${hashMigrationSql(readFileSync(join(REAL, name, "migration.sql")))}`);
    }
  });

  it("ALLOWED_DESTRUCTIVE.txt is empty today (additive-only is the rule)", () => {
    const names = readFileSync(join(REAL, "ALLOWED_DESTRUCTIVE.txt"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean);
    expect(names).toEqual([]);
  });

  it("the command line exits 0 and says how many migrations it checked", () => {
    const r = spawnSync(process.execPath, [SCRIPT, REAL], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Migration lint clean - \d+ migrations, \d+ released\./);
  });
});

describe("clean fixtures", () => {
  it("accepts ordinary additive migrations", () => {
    const dir = build({
      folders: {
        "20260101000000_init": OK_SQL,
        "20260102000000_add_column": 'ALTER TABLE "Thing" ADD COLUMN "note" TEXT;\nCREATE INDEX "Thing_note_idx" ON "Thing"("note");\n',
      },
    });
    expect(lintMigrations(dir)).toMatchObject({ problems: [], migrations: 2, released: 2 });
  });

  it("accepts CRLF line endings and Arabic text in comments and literals", () => {
    const dir = build({ folders: { "20260101000000_init": '-- جدول الأشياء\r\nINSERT INTO "Thing" ("id") VALUES (\'مرحبا\');\r\n' } });
    expect(rules(dir)).toEqual([]);
  });

  it("does not mind ALTER COLUMN ... SET DEFAULT / DROP NOT NULL, even in a new migration", () => {
    expect(
      newMigration(
        ['ALTER TABLE "A" ALTER COLUMN "y" DROP NOT NULL;', 'ALTER TABLE "A" ALTER COLUMN "z" SET DEFAULT 1;', ""].join("\n"),
      ),
    ).toEqual([]);
  });

  it("ignores a destructive word in a comment", () => {
    const dir = build({
      folders: { "20260101000000_init": `-- we do NOT DROP TABLE here, nor TRUNCATE\n/* DELETE FROM "x" would be wrong */\n${OK_SQL}` },
    });
    expect(rules(dir)).toEqual([]);
  });

  it("accepts a folder that is not released yet when it sorts after the last released one", () => {
    const dir = build({
      folders: { "20260101000000_init": OK_SQL, "20260201000000_next": OK_SQL },
      released: ["20260101000000_init"],
    });
    expect(lintMigrations(dir)).toMatchObject({ problems: [], migrations: 2, released: 1 });
  });

  it("RELEASED.txt may carry comments and blank lines", () => {
    const dir = build({
      folders: { "20260101000000_init": OK_SQL },
      released: ["# applied to production on 2026-01-01", "", `${pin("20260101000000_init", OK_SQL)}   # first deploy`],
    });
    expect(rules(dir)).toEqual([]);
  });
});

describe("encoding", () => {
  it("[bom] rejects a UTF-8 byte-order mark", () => {
    const dir = build({ folders: { "20260101000000_init": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(OK_SQL)]) } });
    const problems = lintMigrations(dir).problems;
    expect(problems.map((p) => p.rule)).toEqual(["bom"]);
    expect(problems[0]?.where).toBe("20260101000000_init/migration.sql");
  });

  it("[encoding] rejects bytes that are not UTF-8", () => {
    const dir = build({ folders: { "20260101000000_init": Buffer.concat([Buffer.from("-- "), Buffer.from([0xc3, 0x28]), Buffer.from("\n")]) } });
    expect(rules(dir)).toEqual(["encoding"]);
  });

  it("[encoding] rejects UTF-16 (what PowerShell redirection writes)", () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(OK_SQL, "utf16le")]);
    const dir = build({ folders: { "20260101000000_init": utf16 } });
    expect(rules(dir)).toEqual(["encoding"]);
  });
});

describe("[destructive] - the hard list, judged in every folder, released or not", () => {
  const cases: Array<[string, string]> = [
    ["DROP TABLE", 'DROP TABLE "Thing";'],
    ["DROP TABLE (if exists, lower case)", 'drop table if exists "Thing";'],
    ["DROP COLUMN", 'ALTER TABLE "Thing" DROP COLUMN "note";'],
    ["DROP COLUMN without the COLUMN keyword", 'ALTER TABLE "User" DROP "bio";'],
    ["DROP ... IF EXISTS without the COLUMN keyword", 'ALTER TABLE "User" DROP IF EXISTS "bio";'],
    ["one DROP among several actions", 'ALTER TABLE "User" ADD COLUMN "a" TEXT, DROP "bio", ADD COLUMN "b" TEXT;'],
    ["DROP TYPE", 'DROP TYPE "Kind";'],
    ["DROP SCHEMA", "DROP SCHEMA public CASCADE;"],
    ["DROP DATABASE", "DROP DATABASE zaki;"],
    ["TRUNCATE", 'TRUNCATE TABLE "Thing";'],
    ["DELETE FROM", 'DELETE FROM "Thing" WHERE "id" = \'x\';'],
    ["ALTER COLUMN ... TYPE", 'ALTER TABLE "Thing" ALTER COLUMN "n" TYPE BIGINT;'],
    ["ALTER COLUMN ... SET DATA TYPE", 'ALTER TABLE "Thing" ALTER COLUMN "n" SET DATA TYPE TEXT USING "n"::text;'],
    ["a statement hidden in a DO block", 'DO $$ BEGIN\n  DROP TABLE "Thing";\nEND $$;'],
    ["a statement hidden after a comment on the same line", 'SELECT 1; -- harmless\nDELETE\n  FROM "Thing";'],
  ];

  it.each(cases)("rejects %s", (_label, sql) => {
    const dir = build({ folders: { "20260101000000_init": OK_SQL, "20260102000000_bad": sql } });
    const problems = lintMigrations(dir).problems;
    expect(problems.map((p) => p.rule)).toContain("destructive");
    expect(problems.find((p) => p.rule === "destructive")?.where).toBe("20260102000000_bad/migration.sql");
  });

  it("ALLOWED_DESTRUCTIVE.txt exempts exactly the folders it names", () => {
    const dir = build({
      folders: {
        "20260101000000_init": OK_SQL,
        "20260102000000_approved": 'DROP TABLE "Old";',
        "20260103000000_other": 'DROP TABLE "Other";',
      },
      allowed: ["20260102000000_approved"],
    });
    const problems = lintMigrations(dir).problems;
    expect(problems.map((p) => p.where)).toEqual(["20260103000000_other/migration.sql"]);
  });

  it("the message says how to allow one on purpose", () => {
    const problems = newMigration('DROP TABLE "Old";');
    expect(problems[0]?.message).toContain("ALLOWED_DESTRUCTIVE.txt");
  });
});

describe("the review rules - what an empty database cannot see, judged in every NEW migration", () => {
  const flagged: Array<[string, string, string]> = [
    // [what, sql, rule]
    ["DROP CONSTRAINT", 'ALTER TABLE "Task" DROP CONSTRAINT "Task_userId_fkey";', "destructive"],
    ["DROP INDEX", 'DROP INDEX "User_email_key";', "destructive"],
    ["DROP INDEX IF EXISTS", 'DROP INDEX IF EXISTS "User_email_key";', "destructive"],
    ["DROP TRIGGER", 'DROP TRIGGER notify ON "Event";', "destructive"],
    ["DROP FUNCTION", "DROP FUNCTION notify_event();", "destructive"],
    ["DROP VIEW", 'DROP VIEW "Open_Tasks";', "destructive"],
    ["DROP EXTENSION", "DROP EXTENSION vector;", "destructive"],
    ["DROP SEQUENCE", "DROP SEQUENCE counter_seq;", "destructive"],
    ["RENAME COLUMN", 'ALTER TABLE "User" RENAME COLUMN "a" TO "b";', "rename"],
    ["RENAME without the COLUMN keyword", 'ALTER TABLE "User" RENAME "a" TO "b";', "rename"],
    ["RENAME TO (table)", 'ALTER TABLE "User" RENAME TO "Person";', "rename"],
    ["RENAME TO (index)", 'ALTER INDEX "User_a_idx" RENAME TO "User_b_idx";', "rename"],
    ["RENAME CONSTRAINT", 'ALTER TABLE "User" RENAME CONSTRAINT "a" TO "b";', "rename"],
    ["RENAME VALUE (enum)", `ALTER TYPE "Role" RENAME VALUE 'A' TO 'B';`, "rename"],
    ["ADD COLUMN ... NOT NULL without a DEFAULT", 'ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL;', "data-dependent"],
    ["ADD ... NOT NULL without the COLUMN keyword", 'ALTER TABLE "User" ADD "status" TEXT NOT NULL;', "data-dependent"],
    ["ADD COLUMN IF NOT EXISTS ... NOT NULL", 'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL;', "data-dependent"],
    ["one NOT NULL column among several actions", 'ALTER TABLE "User" ADD COLUMN "a" TEXT, ADD COLUMN "b" TEXT NOT NULL;', "data-dependent"],
    ["ADD COLUMN ... PRIMARY KEY on a table with rows", 'ALTER TABLE "User" ADD COLUMN "k" TEXT PRIMARY KEY;', "data-dependent"],
    ["SET NOT NULL", 'ALTER TABLE "User" ALTER COLUMN "bio" SET NOT NULL;', "data-dependent"],
    ["SET NOT NULL without the COLUMN keyword", 'ALTER TABLE "User" ALTER "bio" SET NOT NULL;', "data-dependent"],
    ["UPDATE without WHERE", `UPDATE "User" SET "bio" = 'x';`, "data-dependent"],
    ["CREATE UNIQUE INDEX on an existing table", 'CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");', "data-dependent"],
    ["CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS", 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "User_phone_key" ON "User"("phone");', "data-dependent"],
    ["a unique index on a new column that has a DEFAULT (every existing row gets the same value)", `ALTER TABLE "User" ADD COLUMN "k" TEXT DEFAULT 'a';\nCREATE UNIQUE INDEX "User_k_key" ON "User"("k");`, "data-dependent"],
    ["a unique index on another table than the one that got the new column", 'ALTER TABLE "User" ADD COLUMN "k" TEXT;\nCREATE UNIQUE INDEX "Org_k_key" ON "Org"("k");', "data-dependent"],
    ["a UNIQUE constraint over an existing column, beside an unrelated new one", 'ALTER TABLE "User" ADD COLUMN "k" TEXT, ADD CONSTRAINT "User_phone_key" UNIQUE ("phone");', "data-dependent"],
    ["ADD CONSTRAINT ... UNIQUE on an existing table", 'ALTER TABLE "User" ADD CONSTRAINT "User_phone_key" UNIQUE ("phone");', "data-dependent"],
    ["ADD UNIQUE on an existing table", 'ALTER TABLE "User" ADD UNIQUE ("phone");', "data-dependent"],
    ["CREATE EXTENSION", "CREATE EXTENSION IF NOT EXISTS vector;", "environment"],
  ];

  it.each(flagged)("flags %s", (_what, sql, rule) => {
    const problems = newMigration(sql);
    expect(problems.map((p) => p.rule)).toEqual([rule]);
    expect(problems[0]?.where).toBe(`${CHANGE}/migration.sql`);
  });

  it.each(flagged)("each message names the way out: ALLOWED_DESTRUCTIVE.txt (%s)", (_what, sql) => {
    expect(newMigration(sql)[0]?.message).toContain("prisma/migrations/ALLOWED_DESTRUCTIVE.txt");
  });

  it.each(flagged)("ALLOWED_DESTRUCTIVE.txt exempts the folder from it (%s)", (_what, sql) => {
    expect(newMigration(sql, { allowed: [CHANGE] })).toEqual([]);
  });

  const clean: Array<[string, string]> = [
    ["ADD COLUMN ... NOT NULL DEFAULT", `ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';`],
    ["ADD COLUMN, nullable", 'ALTER TABLE "User" ADD COLUMN "note" TEXT;'],
    ["ADD COLUMN ... SERIAL", 'ALTER TABLE "User" ADD COLUMN "n" SERIAL NOT NULL;'],
    ["several additive actions", `ALTER TABLE "T" ADD COLUMN "a" TEXT NOT NULL DEFAULT 'x', ADD COLUMN "b" TEXT;`],
    ["ALTER COLUMN ... DROP NOT NULL", 'ALTER TABLE "User" ALTER COLUMN "bio" DROP NOT NULL;'],
    ["ALTER COLUMN ... SET DEFAULT", `ALTER TABLE "User" ALTER COLUMN "bio" SET DEFAULT 'x';`],
    ["UPDATE with a WHERE", `UPDATE "User" SET "bio" = 'x' WHERE "bio" IS NULL;`],
    ["INSERT ... ON CONFLICT DO NOTHING (a repeatable data move)", `INSERT INTO "Thing" ("id") VALUES ('a') ON CONFLICT DO NOTHING;`],
    ["a plain index", 'CREATE INDEX "User_email_idx" ON "User"("email");'],
    ["a foreign key", 'ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;'],
    ["a comment that names a rule", '-- never RENAME COLUMN, never SET NOT NULL, never DROP INDEX\n/* CREATE EXTENSION later */\nSELECT 1;'],
    ["a word inside a string literal", `INSERT INTO "Note" ("body") VALUES ('please RENAME COLUMN, SET NOT NULL or UPDATE all');`],
    // Prisma writes exactly this for `username String? @unique`: the column is born NULL, and NULLs never collide.
    ["a new nullable column and its unique index", 'ALTER TABLE "User" ADD COLUMN "username" TEXT;\nCREATE UNIQUE INDEX "User_username_key" ON "User"("username");'],
    ["a unique index over an existing column and a new nullable one", 'ALTER TABLE "User" ADD COLUMN "k" TEXT;\nCREATE UNIQUE INDEX "User_email_k_key" ON "User"("email", "k");'],
    ["a new nullable column and its UNIQUE constraint in the same ALTER", 'ALTER TABLE "User" ADD COLUMN "k" TEXT, ADD CONSTRAINT "User_k_key" UNIQUE ("k");'],
    ["the same without quotes or COLUMN", "ALTER TABLE users ADD slug TEXT;\nCREATE UNIQUE INDEX users_slug_key ON users(slug);"],
    ["a new nullable column and a unique index with a sort order and a WHERE", 'ALTER TABLE "User" ADD COLUMN "k" TEXT;\nCREATE UNIQUE INDEX "User_k_key" ON "User" ("k" DESC) WHERE "k" IS NOT NULL;'],
    ["a new table with its own unique index and a NOT NULL column",
      'CREATE TABLE "Token" ("id" TEXT NOT NULL, "hash" TEXT NOT NULL, CONSTRAINT "Token_pkey" PRIMARY KEY ("id"));\nCREATE UNIQUE INDEX "Token_hash_key" ON "Token"("hash");'],
    ["NOT NULL columns and constraints added to a table created in the same migration",
      'CREATE TABLE "Fresh" ("id" TEXT NOT NULL);\nALTER TABLE "Fresh" ADD COLUMN "k" TEXT NOT NULL;\nALTER TABLE "Fresh" ALTER COLUMN "k" SET NOT NULL;\nALTER TABLE "Fresh" ADD CONSTRAINT "Fresh_k_key" UNIQUE ("k");'],
  ];

  it.each(clean)("leaves alone: %s", (_what, sql) => {
    expect(newMigration(sql)).toEqual([]);
  });

  it("does not judge a RELEASED folder by these rules - it is frozen by its hash instead", () => {
    const sql = [
      'ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL;',
      'ALTER TABLE "User" ALTER COLUMN "bio" SET NOT NULL;',
      'ALTER TABLE "User" RENAME COLUMN "a" TO "b";',
      `UPDATE "User" SET "bio" = 'x';`,
      'DROP INDEX "User_email_key";',
      'CREATE EXTENSION vector;',
      "",
    ].join("\n");
    const dir = build({ folders: { [INIT]: OK_SQL, [CHANGE]: sql } }); // both released
    expect(lintMigrations(dir).problems).toEqual([]);
  });

  it("reports each kind once per migration, however often it occurs", () => {
    const sql = 'ALTER TABLE "A" RENAME COLUMN "a" TO "b";\nALTER TABLE "B" RENAME COLUMN "a" TO "b";\n';
    expect(newMigration(sql).map((p) => p.rule)).toEqual(["rename"]);
  });

  it("reports different kinds side by side", () => {
    const sql = 'ALTER TABLE "A" RENAME COLUMN "a" TO "b";\nALTER TABLE "A" ALTER COLUMN "c" SET NOT NULL;\nCREATE EXTENSION vector;\n';
    expect(newMigration(sql).map((p) => p.rule).sort()).toEqual(["data-dependent", "environment", "rename"]);
  });
});

describe("[enum-only]", () => {
  it("accepts a migration made only of ALTER TYPE ... ADD VALUE", () => {
    const dir = build({
      folders: {
        "20260101000000_init": OK_SQL,
        "20260102000000_lead": `-- new role\nALTER TYPE "OrgRole" ADD VALUE 'LEAD';\nALTER TYPE "OrgRole" ADD VALUE IF NOT EXISTS 'COACH';\n`,
      },
    });
    expect(rules(dir)).toEqual([]);
  });

  it("rejects ADD VALUE mixed with any other statement", () => {
    const dir = build({
      folders: {
        "20260101000000_init": OK_SQL,
        "20260102000000_mixed": `ALTER TYPE "OrgRole" ADD VALUE 'LEAD';\nALTER TABLE "OrganizationMember" ADD COLUMN "status" TEXT;\n`,
      },
    });
    const problems = lintMigrations(dir).problems;
    expect(problems.map((p) => p.rule)).toEqual(["enum-only"]);
    expect(problems[0]?.where).toBe("20260102000000_mixed/migration.sql");
  });

  it("does not mistake CREATE TYPE ... AS ENUM for an added value", () => {
    const dir = build({
      folders: { "20260101000000_init": `CREATE TYPE "Kind" AS ENUM ('A', 'B');\n${OK_SQL}` },
    });
    expect(rules(dir)).toEqual([]);
  });

  it("a semicolon inside a string literal does not split the statement", () => {
    const dir = build({
      folders: { "20260101000000_init": `ALTER TYPE "OrgRole" ADD VALUE 'A;B';\n` },
    });
    expect(rules(dir)).toEqual([]);
  });
});

describe("[shape] and [order]", () => {
  it("rejects a folder that is not YYYYMMDDHHMMSS_name", () => {
    const dir = build({ folders: { "20260101000000_init": OK_SQL, "2026_bad": OK_SQL, "notes": OK_SQL }, released: ["20260101000000_init"] });
    const found = lintMigrations(dir).problems.filter((p) => p.rule === "shape").map((p) => p.where);
    expect(found.sort()).toEqual(["2026_bad", "notes"]);
  });

  it("rejects a timestamp that is not a real date", () => {
    const dir = build({ folders: { "20261340000000_oops": OK_SQL } });
    expect(rules(dir)).toEqual(["shape"]);
  });

  it("rejects two folders with the same timestamp", () => {
    const dir = build({ folders: { "20260101000000_a": OK_SQL, "20260101000000_b": OK_SQL } });
    const problems = lintMigrations(dir).problems;
    expect(problems.map((p) => p.rule)).toEqual(["order"]);
    expect(problems[0]?.where).toBe("20260101000000_b");
  });

  it("rejects a folder without migration.sql", () => {
    const dir = build({ folders: { "20260101000000_init": null } });
    expect(rules(dir)).toEqual(["missing-sql"]);
  });
});

describe("released migrations are never renamed or removed", () => {
  const history = {
    "20261017123500_it_tickets": OK_SQL,
    "20261017133500_departments": OK_SQL,
  };

  it("[released-missing] a listed folder that has gone", () => {
    const dir = build({ folders: { "20261017123500_it_tickets": OK_SQL }, released: ["20261017123500_it_tickets", "20261017133500_departments"] });
    const problems = lintMigrations(dir).problems;
    expect(problems.map((p) => p.rule)).toEqual(["released-missing"]);
    expect(problems[0]?.where).toBe("20261017133500_departments");
  });

  it("the 2026-10-19 incident: renaming a released folder is caught twice over", () => {
    // departments (13:35) was released; someone renames it to 12:30 so it sorts before it_tickets.
    const dir = build({
      folders: { "20261017123000_departments": OK_SQL, "20261017123500_it_tickets": OK_SQL },
      released: Object.keys(history),
    });
    const found = rules(dir);
    expect(found).toContain("released-missing");
    expect(found).toContain("unreleased-before-last");
  });

  it("[unreleased-before-last] a new folder inserted before the last released one", () => {
    const dir = build({
      folders: { "20260101000000_init": OK_SQL, "20260301000000_late": OK_SQL, "20260201000000_inserted": OK_SQL },
      released: ["20260101000000_init", "20260301000000_late"],
    });
    const problems = lintMigrations(dir).problems;
    expect(problems.map((p) => p.rule)).toEqual(["unreleased-before-last"]);
    expect(problems[0]?.where).toBe("20260201000000_inserted");
  });

  it("[released-file] RELEASED.txt is required", () => {
    const dir = build({ folders: { "20260101000000_init": OK_SQL }, released: null });
    expect(rules(dir)).toEqual(["released-file"]);
  });

  it("[released-file] a folder listed twice", () => {
    const dir = build({ folders: { "20260101000000_init": OK_SQL }, released: ["20260101000000_init", "20260101000000_init"] });
    expect(rules(dir)).toEqual(["released-file"]);
  });
});

describe("a released migration is pinned to the sha256 of its SQL - never edited", () => {
  const RELEASED_SQL = 'CREATE TABLE "Thing" ("id" TEXT NOT NULL);\nCREATE INDEX "Thing_id_idx" ON "Thing"("id");\n';

  it("accepts the right pin", () => {
    const dir = build({ folders: { [INIT]: RELEASED_SQL } });
    expect(lintMigrations(dir).problems).toEqual([]);
  });

  it("[released-changed] fails when the SQL of a released migration is edited, even by one character", () => {
    const pinned = pin(INIT, RELEASED_SQL);
    const dir = build({ folders: { [INIT]: RELEASED_SQL.replace("Thing_id_idx", "Thing_id_idx2") }, released: [pinned] });
    const problems = lintMigrations(dir).problems;
    expect(problems.map((p) => p.rule)).toEqual(["released-changed"]);
    expect(problems[0]?.where).toBe(INIT);
    expect(problems[0]?.message).toMatch(/never edited/);
    expect(problems[0]?.message).toMatch(/NEW migration/);
  });

  it("[released-changed] fails when the file is truncated (the 2026-10-19 accident: the content of it_tickets shrank in a working tree)", () => {
    const dir = build({ folders: { [INIT]: RELEASED_SQL.slice(0, 40) }, released: [pin(INIT, RELEASED_SQL)] });
    expect(rules(dir)).toEqual(["released-changed"]);
  });

  it("tolerates CRLF vs LF: the pin is taken over LF-normalised text (Windows checkouts, Linux CI)", () => {
    const pinnedLf = pin(INIT, RELEASED_SQL);
    const crlf = RELEASED_SQL.replace(/\n/g, "\r\n");
    expect(lintMigrations(build({ folders: { [INIT]: crlf }, released: [pinnedLf] })).problems).toEqual([]);
    const pinnedCrlf = pin(INIT, crlf);
    expect(pinnedCrlf).toBe(pinnedLf);
    expect(lintMigrations(build({ folders: { [INIT]: RELEASED_SQL }, released: [pinnedCrlf] })).problems).toEqual([]);
  });

  it("does NOT tolerate other whitespace changes (trailing spaces, a missing final newline)", () => {
    const pinned = pin(INIT, RELEASED_SQL);
    expect(rules(build({ folders: { [INIT]: `${RELEASED_SQL} ` }, released: [pinned] }))).toEqual(["released-changed"]);
    expect(rules(build({ folders: { [INIT]: RELEASED_SQL.trimEnd() }, released: [pinned] }))).toEqual(["released-changed"]);
  });

  it("[released-file] a name without a pin is refused, and the message says which command prints the line", () => {
    const dir = build({ folders: { [INIT]: RELEASED_SQL }, released: [INIT + " "] });
    const problems = lintMigrations(dir).problems;
    expect(problems.map((p) => p.rule)).toEqual(["released-file"]);
    expect(problems[0]?.message).toContain("--hash");
    expect(problems[0]?.message).toContain(INIT);
  });

  it.each([
    ["a hash that is too short", `${INIT} sha256:abc123`],
    ["upper-case hex", `${INIT} sha256:${hashMigrationSql(Buffer.from(RELEASED_SQL)).toUpperCase()}`],
    ["another algorithm", `${INIT} md5:${"a".repeat(32)}`],
    ["a bare hash with no prefix", `${INIT} ${hashMigrationSql(Buffer.from(RELEASED_SQL))}`],
    ["an extra word after the pin", `${INIT} sha256:${hashMigrationSql(Buffer.from(RELEASED_SQL))} released-on-monday`],
  ])("[released-file] a malformed pin is refused: %s", (_what, line) => {
    const dir = build({ folders: { [INIT]: RELEASED_SQL }, released: [line] });
    expect(lintMigrations(dir).problems.map((p) => p.rule)).toContain("released-file");
  });

  it("a pin for a folder that is gone is reported as gone, not as a changed file", () => {
    const dir = build({ folders: { [CHANGE]: OK_SQL }, released: [pin(INIT, RELEASED_SQL), CHANGE] });
    const found = lintMigrations(dir).problems;
    expect(found.map((p) => p.rule)).toEqual(["released-missing"]);
  });

  it("a new folder is not pinned until it has been released, and is not a problem meanwhile", () => {
    const dir = build({ folders: { [INIT]: RELEASED_SQL, [CHANGE]: OK_SQL }, released: [INIT] });
    expect(lintMigrations(dir).problems).toEqual([]);
  });
});

describe("hashMigrationSql", () => {
  it("is the sha256 of the text, hex (a published test vector)", () => {
    expect(hashMigrationSql(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("does not change with the line endings", () => {
    expect(hashMigrationSql(Buffer.from("a\r\nb\r\n"))).toBe(hashMigrationSql(Buffer.from("a\nb\n")));
  });

  it("does change with the content, and with a lone carriage return", () => {
    expect(hashMigrationSql(Buffer.from("a\nb\n"))).not.toBe(hashMigrationSql(Buffer.from("a\nc\n")));
    expect(hashMigrationSql(Buffer.from("a\rb\n"))).not.toBe(hashMigrationSql(Buffer.from("a\nb\n")));
  });

  it("hashes bytes, so text that is not UTF-8 neither throws nor collides", () => {
    expect(hashMigrationSql(Buffer.from([0xc3, 0x28]))).not.toBe(hashMigrationSql(Buffer.from([0xc3, 0x29])));
  });
});

describe("--hash prints the line to paste into RELEASED.txt", () => {
  it("one `name sha256:<hex>` per folder, equal to what the linter checks", () => {
    const sqlA = 'CREATE TABLE "A" ("id" TEXT);\n';
    const sqlB = 'CREATE TABLE "B" ("id" TEXT);\r\n';
    const dir = build({ folders: { "20260101000000_a": sqlA, "20260102000000_b": sqlB }, released: [] });
    const r = spawnSync(process.execPath, [SCRIPT, "--hash", `--dir=${dir}`], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split(/\r?\n/)).toEqual([pin("20260101000000_a", sqlA), pin("20260102000000_b", sqlB)]);
  });

  it("only the folders it is asked for, and a pasted line passes the linter", () => {
    const dir = build({ folders: { "20260101000000_a": OK_SQL, "20260102000000_b": OK_SQL }, released: [] });
    const r = spawnSync(process.execPath, [SCRIPT, "--hash", "20260101000000_a", `--dir=${dir}`], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pin("20260101000000_a", OK_SQL));
    writeFileSync(join(dir, "RELEASED.txt"), r.stdout);
    expect(lintMigrations(dir).problems).toEqual([]);
  });

  it("exits 1 for a folder that does not exist", () => {
    const dir = build({ folders: { "20260101000000_a": OK_SQL }, released: [] });
    const r = spawnSync(process.execPath, [SCRIPT, "--hash", "20260101000000_nope", `--dir=${dir}`], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("20260101000000_nope");
  });
});

describe("[lock]", () => {
  it("requires migration_lock.toml", () => {
    expect(rules(build({ folders: { "20260101000000_init": OK_SQL }, lock: null }))).toEqual(["lock"]);
  });

  it("requires provider = postgresql", () => {
    expect(rules(build({ folders: { "20260101000000_init": OK_SQL }, lock: 'provider = "mysql"\n' }))).toEqual(["lock"]);
  });
});

describe("sqlViews / sqlStatements", () => {
  it("removes comments but keeps string contents in `code`, and blanks them in `skeleton`", () => {
    const { code, skeleton } = sqlViews("SELECT 'a;b' /* DROP TABLE x */; -- TRUNCATE\nSELECT $f$ x; y $f$;");
    expect(code).not.toContain("DROP TABLE");
    expect(code).not.toContain("TRUNCATE");
    expect(code).toContain("'a;b'");
    expect(skeleton.split(";").map((s) => s.trim()).filter(Boolean)).toHaveLength(2);
  });

  it("splits statements only at a real semicolon, and keeps `code` and `skeleton` aligned per statement", () => {
    const stmts = sqlStatements(`CREATE TABLE "A" ("x" TEXT DEFAULT 'a;b');\n-- note; with a semicolon\nDO $$ BEGIN PERFORM 1; END $$;\nUPDATE "A" SET "x" = 'y' WHERE "x" IS NULL`).filter((s) => s.code.trim());
    expect(stmts).toHaveLength(3);
    expect(stmts[0]?.code).toContain("'a;b'");
    expect(stmts[0]?.skeleton).toContain("''");
    expect(stmts[1]?.skeleton).toMatch(/^\s*DO \$\$\$\$/);
    expect(stmts[2]?.code.trim().startsWith("UPDATE")).toBe(true);
  });

  it("`named` keeps quoted identifiers (the rules that need a table or column name read it) and still blanks strings", () => {
    const [stmt] = sqlStatements(`ALTER TABLE "User" ADD COLUMN "bio" TEXT DEFAULT 'x;y' -- note`);
    expect(stmt?.named).toContain('"User"');
    expect(stmt?.named).toContain('"bio"');
    expect(stmt?.named).not.toContain("x;y");
    expect(stmt?.skeleton).not.toContain('"bio"'); // blanked there
  });

  it("keeps the old two-view output identical (trailing text after the last semicolon included)", () => {
    expect(sqlViews("SELECT 1; SELECT 2").code).toBe("SELECT 1; SELECT 2");
    expect(sqlViews("SELECT 1;\n").code).toBe("SELECT 1;\n");
  });
});

describe("command line", () => {
  it("exits 1 and prints `LINT [rule] where: message` for a problem", () => {
    const dir = build({ folders: { "20260101000000_init": 'DROP TABLE "Thing";' } });
    const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/LINT \[destructive\] 20260101000000_init\/migration\.sql: contains DROP TABLE/);
  });

  it("exits 1 for a directory that does not exist", () => {
    const r = spawnSync(process.execPath, [SCRIPT, join(tmpdir(), "zaki-no-such-migrations-dir")], { encoding: "utf8" });
    expect(r.status).toBe(1);
  });
});
