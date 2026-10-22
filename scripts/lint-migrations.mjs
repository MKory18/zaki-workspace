#!/usr/bin/env node
/**
 * Migration linter - the rules that came out of the 2026-10-19 deployment
 * incident (docs/DEPLOYMENT-INCIDENT-2026-10-19.md), enforced instead of remembered.
 *
 *   node scripts/lint-migrations.mjs [migrations-dir]      (default: prisma/migrations)
 *
 * It runs in `npm test` (tests/migrations-lint.test.ts) and in CI, before any
 * migration is applied. Exit 0 = clean, 1 = at least one problem (printed as
 * `LINT [rule] where: message`).
 *
 * The rules:
 *
 *  [shape]      every folder is `YYYYMMDDHHMMSS_name` with a real date.
 *  [order]      timestamps are strictly increasing (no two folders share one).
 *  [missing-sql] every folder holds a migration.sql.
 *  [bom] [encoding]   every migration.sql is UTF-8 with NO byte-order mark.
 *  [destructive] no DROP TABLE / DROP COLUMN / DROP TYPE / DROP SCHEMA /
 *               DROP DATABASE / TRUNCATE / DELETE FROM / ALTER COLUMN ... TYPE -
 *               unless the folder is named in ALLOWED_DESTRUCTIVE.txt.
 *  [enum-only]  a migration that adds enum values (ALTER TYPE ... ADD VALUE)
 *               contains NOTHING else: a new value cannot be used in the
 *               transaction that adds it, so it gets a migration of its own.
 *  [released-missing]  every folder listed in RELEASED.txt still exists. A
 *               folder that was ever applied is never renamed or removed: the
 *               database remembers its name, and a renamed folder is a
 *               migration that "was never applied". That is the incident.
 *  [unreleased-before-last]  a folder NOT in RELEASED.txt must sort AFTER the
 *               last released one. Inserting a migration in the middle of the
 *               history breaks every database that already ran the later ones.
 *  [released-file]  RELEASED.txt exists, and lists each folder once.
 *  [lock]       migration_lock.toml exists and says provider = "postgresql".
 *
 * RELEASED.txt:  one folder name per line; blank lines and `#` comments allowed.
 *   A folder joins the list once it has been deployed to a shared database
 *   (production) - not before: until then it may still be fixed in place.
 * ALLOWED_DESTRUCTIVE.txt: same format; folders exempt from [destructive] only.
 *   Empty today. Adding a line is a decision for the owner, reviewed in the PR.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FOLDER_SHAPE = /^(\d{14})_([A-Za-z0-9_]+)$/;

const DESTRUCTIVE = [
  ["DROP TABLE", /\bDROP\s+TABLE\b/i],
  ["DROP COLUMN", /\bDROP\s+COLUMN\b/i],
  ["DROP TYPE", /\bDROP\s+TYPE\b/i],
  ["DROP SCHEMA", /\bDROP\s+SCHEMA\b/i],
  ["DROP DATABASE", /\bDROP\s+DATABASE\b/i],
  ["TRUNCATE", /\bTRUNCATE\b/i],
  ["DELETE FROM", /\bDELETE\s+FROM\b/i],
  ["ALTER COLUMN ... TYPE", /\bALTER\s+COLUMN\s+(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)\s+(?:SET\s+DATA\s+)?TYPE\b/i],
];

const ENUM_ADD_VALUE = /^\s*ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE\b/i;

/** `YYYYMMDDHHMMSS` -> true when it is a plausible calendar date and time. */
function plausibleTimestamp(ts) {
  const month = Number(ts.slice(4, 6));
  const day = Number(ts.slice(6, 8));
  const hour = Number(ts.slice(8, 10));
  const minute = Number(ts.slice(10, 12));
  const second = Number(ts.slice(12, 14));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 59;
}

/**
 * Walk the SQL once and produce two views of it:
 *  - `code`: comments removed, everything else untouched. The destructive check
 *    reads this one, so a statement hidden in a DO block or an EXECUTE string is
 *    still seen, while "-- no DROP TABLE here" is not a finding.
 *  - `skeleton`: comments removed AND string / identifier / dollar-quoted bodies
 *    blanked, so splitting on `;` is exact. The enum check reads this one.
 */
export function sqlViews(sql) {
  let code = "";
  let skeleton = "";
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end; // the newline itself is copied by the next turn
      continue;
    }
    if (ch === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      code += " ";
      skeleton += " ";
      i = j;
      continue;
    }
    if (ch === "'") {
      const prev = sql[i - 1] ?? "";
      const escapeString = /[eE]/.test(prev) && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? "");
      let j = i + 1;
      while (j < n) {
        if (escapeString && sql[j] === "\\") {
          j += 2;
        } else if (sql[j] === "'") {
          if (sql[j + 1] === "'") j += 2;
          else break;
        } else {
          j += 1;
        }
      }
      code += sql.slice(i, j + 1);
      skeleton += "''";
      i = j + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') j += 2;
          else break;
        } else {
          j += 1;
        }
      }
      const ident = sql.slice(i, j + 1);
      code += ident;
      skeleton += `"${"x".repeat(Math.max(1, ident.length - 2))}"`;
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? n : end + tag[0].length;
        code += sql.slice(i, stop);
        skeleton += end === -1 ? tag[0] : `${tag[0]}${tag[0]}`;
        i = stop;
        continue;
      }
    }
    code += ch;
    skeleton += ch;
    i += 1;
  }
  return { code, skeleton };
}

function readList(file) {
  if (!existsSync(file)) return null;
  const names = [];
  for (const raw of readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line) names.push(line);
  }
  return names;
}

/**
 * Lint a migrations directory. Returns `{ problems, migrations, released }`
 * where each problem is `{ rule, where, message }`.
 */
export function lintMigrations(dir) {
  const problems = [];
  const add = (rule, where, message) => problems.push({ rule, where, message });

  const entries = readdirSync(dir, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  // ---- shape and order -------------------------------------------------
  let previousTs = null;
  for (const name of folders) {
    const m = FOLDER_SHAPE.exec(name);
    if (!m) {
      add("shape", name, "folder name must look like 20261017123000_short_name (14-digit timestamp, underscore, letters/digits/underscores)");
      continue;
    }
    const ts = m[1];
    if (!plausibleTimestamp(ts)) add("shape", name, `"${ts}" is not a real date and time (YYYYMMDDHHMMSS)`);
    if (previousTs !== null && ts <= previousTs) {
      add("order", name, `timestamp ${ts} does not come strictly after the previous folder's ${previousTs}`);
    }
    previousTs = ts;
  }

  // ---- RELEASED.txt / ALLOWED_DESTRUCTIVE.txt ---------------------------
  const released = readList(join(dir, "RELEASED.txt"));
  const allowedDestructive = new Set(readList(join(dir, "ALLOWED_DESTRUCTIVE.txt")) ?? []);
  if (released === null) {
    add("released-file", "RELEASED.txt", "missing: list every migration folder that has been applied to a shared database, one per line");
  } else {
    const seen = new Set();
    for (const name of released) {
      if (seen.has(name)) add("released-file", "RELEASED.txt", `${name} is listed twice`);
      seen.add(name);
      if (!FOLDER_SHAPE.test(name)) add("released-file", "RELEASED.txt", `"${name}" is not a migration folder name`);
      if (!folders.includes(name)) {
        add(
          "released-missing",
          name,
          "is listed in RELEASED.txt but the folder is gone. A released migration is never renamed or removed - " +
            "the database remembers its name (docs/DEPLOYMENT-INCIDENT-2026-10-19.md). Restore the folder.",
        );
      }
    }
    const releasedTs = released.map((n) => FOLDER_SHAPE.exec(n)?.[1]).filter(Boolean).sort();
    const lastReleased = releasedTs.length > 0 ? releasedTs[releasedTs.length - 1] : null;
    if (lastReleased) {
      for (const name of folders) {
        if (seen.has(name)) continue;
        const ts = FOLDER_SHAPE.exec(name)?.[1];
        if (ts && ts <= lastReleased) {
          add(
            "unreleased-before-last",
            name,
            `is not in RELEASED.txt but sorts before the last released migration (${lastReleased}). ` +
              "Databases that already ran the later ones would never run it. Give it a newer timestamp; " +
              "if it HAS been applied somewhere, add it to RELEASED.txt.",
          );
        }
      }
    }
  }

  // ---- migration_lock.toml ---------------------------------------------
  const lock = join(dir, "migration_lock.toml");
  if (!existsSync(lock) || !/^\s*provider\s*=\s*"postgresql"\s*$/m.test(readFileSync(lock, "utf8"))) {
    add("lock", "migration_lock.toml", 'missing, or its provider is not "postgresql"');
  }

  // ---- every migration.sql ----------------------------------------------
  for (const name of folders) {
    const file = join(dir, name, "migration.sql");
    if (!existsSync(file) || !statSync(file).isFile()) {
      add("missing-sql", name, "has no migration.sql");
      continue;
    }
    const bytes = readFileSync(file);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      add("bom", `${name}/migration.sql`, "starts with a UTF-8 byte-order mark; save it as UTF-8 WITHOUT BOM (the mark ends up inside the SQL Postgres reads)");
      continue;
    }
    if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || bytes.includes(0)) {
      add("encoding", `${name}/migration.sql`, "is UTF-16 (or binary); it must be plain UTF-8");
      continue;
    }
    let sql;
    try {
      sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      add("encoding", `${name}/migration.sql`, "is not valid UTF-8");
      continue;
    }

    const { code, skeleton } = sqlViews(sql);

    if (!allowedDestructive.has(name)) {
      for (const [label, re] of DESTRUCTIVE) {
        if (re.test(code)) {
          add(
            "destructive",
            `${name}/migration.sql`,
            `contains ${label}. Migrations are additive only. If the owner has approved this one, name the folder in ALLOWED_DESTRUCTIVE.txt.`,
          );
        }
      }
    }

    const statements = skeleton
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    const addsEnumValue = statements.some((s) => ENUM_ADD_VALUE.test(s));
    if (addsEnumValue && !statements.every((s) => ENUM_ADD_VALUE.test(s))) {
      add(
        "enum-only",
        `${name}/migration.sql`,
        "adds enum values (ALTER TYPE ... ADD VALUE) AND contains other statements. A new enum value cannot be used " +
          "in the transaction that adds it: give the ADD VALUE statements a migration of their own.",
      );
    }
  }

  return { problems, migrations: folders.length, released: released?.length ?? 0 };
}

function main() {
  const dirArg = process.argv.slice(2).find((a) => a !== "--") ?? join("prisma", "migrations");
  const dir = resolve(process.cwd(), dirArg);
  let result;
  try {
    result = lintMigrations(dir);
  } catch (err) {
    console.error(`lint-migrations: cannot read ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }
  for (const p of result.problems) console.error(`LINT [${p.rule}] ${p.where}: ${p.message}`);
  if (result.problems.length > 0) {
    console.error(`\n${result.problems.length} migration problem(s). See docs/DEPLOYMENT-INCIDENT-2026-10-19.md for why these rules exist.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Migration lint clean - ${result.migrations} migrations, ${result.released} released.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
