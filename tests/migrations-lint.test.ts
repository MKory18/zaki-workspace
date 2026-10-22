import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lintMigrations, sqlViews } from "../scripts/lint-migrations.mjs";

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

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

interface Fixture {
  /** folder name -> migration.sql content (omit the file with null). */
  folders: Record<string, string | Buffer | null>;
  /** RELEASED.txt lines; null = no file. Default: every folder in `folders`. */
  released?: string[] | null;
  allowed?: string[];
  /** migration_lock.toml; null = no file. */
  lock?: string | null;
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
  if (released !== null) writeFileSync(join(dir, "RELEASED.txt"), `${released.join("\n")}\n`);
  if (f.allowed) writeFileSync(join(dir, "ALLOWED_DESTRUCTIVE.txt"), `${f.allowed.join("\n")}\n`);
  return dir;
}

const rules = (dir: string) => lintMigrations(dir).problems.map((p) => p.rule).sort();

describe("the real prisma/migrations folder", () => {
  it("passes every rule", () => {
    const result = lintMigrations(REAL);
    expect(result.problems).toEqual([]);
  });

  it("RELEASED.txt still names all 12 folders that existed on 2026-10-22, and every one still exists", () => {
    const listed = readFileSync(join(REAL, "RELEASED.txt"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean);
    for (const name of HISTORY) {
      expect(listed, `${name} must stay listed in RELEASED.txt`).toContain(name);
      expect(existsSync(join(REAL, name, "migration.sql")), `${name} must still exist`).toBe(true);
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

  it("does not mind ALTER COLUMN ... SET NOT NULL / DROP NOT NULL / DROP INDEX / DROP CONSTRAINT", () => {
    const dir = build({
      folders: {
        "20260101000000_init": [
          'ALTER TABLE "A" ALTER COLUMN "x" SET NOT NULL;',
          'ALTER TABLE "A" ALTER COLUMN "y" DROP NOT NULL;',
          'ALTER TABLE "A" ALTER COLUMN "z" SET DEFAULT 1;',
          'DROP INDEX "A_x_idx";',
          'ALTER TABLE "A" DROP CONSTRAINT "A_fk";',
          "",
        ].join("\n"),
      },
    });
    expect(rules(dir)).toEqual([]);
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
      released: ["# applied to production on 2026-01-01", "", "20260101000000_init   # first deploy"],
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

describe("[destructive]", () => {
  const cases: Array<[string, string]> = [
    ["DROP TABLE", 'DROP TABLE "Thing";'],
    ["DROP TABLE (if exists, lower case)", 'drop table if exists "Thing";'],
    ["DROP COLUMN", 'ALTER TABLE "Thing" DROP COLUMN "note";'],
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

describe("[lock]", () => {
  it("requires migration_lock.toml", () => {
    expect(rules(build({ folders: { "20260101000000_init": OK_SQL }, lock: null }))).toEqual(["lock"]);
  });

  it("requires provider = postgresql", () => {
    expect(rules(build({ folders: { "20260101000000_init": OK_SQL }, lock: 'provider = "mysql"\n' }))).toEqual(["lock"]);
  });
});

describe("sqlViews", () => {
  it("removes comments but keeps string contents in `code`, and blanks them in `skeleton`", () => {
    const { code, skeleton } = sqlViews("SELECT 'a;b' /* DROP TABLE x */; -- TRUNCATE\nSELECT $f$ x; y $f$;");
    expect(code).not.toContain("DROP TABLE");
    expect(code).not.toContain("TRUNCATE");
    expect(code).toContain("'a;b'");
    expect(skeleton.split(";").map((s) => s.trim()).filter(Boolean)).toHaveLength(2);
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
