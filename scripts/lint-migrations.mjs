/**
 * Migration linter - the rules that came out of the 2026-10-19 deployment
 * incident (docs/DEPLOYMENT-INCIDENT-2026-10-19.md), enforced instead of remembered.
 *
 *   node scripts/lint-migrations.mjs [migrations-dir]       lint (default: prisma/migrations)
 *   node scripts/lint-migrations.mjs --hash [folder ...]    print `folder sha256:<hex>` lines for RELEASED.txt
 *   (either form accepts --dir=<migrations-dir>)
 *
 * It runs in `npm test` (tests/migrations-lint.test.ts) and in CI, before any
 * migration is applied. Exit 0 = clean, 1 = at least one problem (printed as
 * `LINT [rule] where: message`).
 *
 * ── Folders ──
 *  [shape]      every folder is `YYYYMMDDHHMMSS_name` with a real date.
 *  [order]      timestamps are strictly increasing (no two folders share one).
 *  [missing-sql] every folder holds a migration.sql.
 *  [bom] [encoding]   every migration.sql is UTF-8 with NO byte-order mark.
 *  [lock]       migration_lock.toml exists and says provider = "postgresql".
 *
 * ── Released migrations (RELEASED.txt) ──
 *  A migration that has run on a shared database is HISTORY. RELEASED.txt holds one line per
 *  released folder:   <folder> sha256:<hex>   - the hash is taken over the SQL with CRLF read as LF, so
 *  a Windows checkout and the Linux CI agree. Get the line with  --hash <folder>.
 *  [released-missing]  every listed folder still exists. Nothing released is renamed or removed: the
 *               database remembers the name, and a renamed folder is a migration that "was never
 *               applied". That is the incident.
 *  [released-changed]  the SQL of a released folder still matches its pin. A released file is never
 *               edited: it already ran, with its old text, in production.
 *  [released-file]  RELEASED.txt exists; each line is `<folder> sha256:<64 hex>`; no folder twice.
 *               A name WITHOUT a pin is refused on purpose: it would be a released migration nothing
 *               protects, and the protection would silently decay.
 *  [unreleased-before-last]  a folder NOT in RELEASED.txt must sort AFTER the last released one.
 *               Inserting a migration in the middle of the history breaks every database that
 *               already ran the later ones.
 *
 * ── What a migration may contain ──
 *  Two tiers. Both are lifted for a folder named in ALLOWED_DESTRUCTIVE.txt (the owner's decision).
 *
 *  Hard (EVERY folder, released or not):
 *  [destructive] DROP TABLE / COLUMN / TYPE / SCHEMA / DATABASE, a column dropped without the COLUMN
 *               keyword, TRUNCATE, DELETE FROM, ALTER COLUMN ... TYPE.
 *  [enum-only]  a migration that adds enum values (ALTER TYPE ... ADD VALUE) contains NOTHING else:
 *               a new value cannot be used in the transaction that adds it.
 *
 *  Review (only folders that are NOT released yet - a released one is frozen by its pin):
 *  The CI deploy runs on an EMPTY database, so it cannot see what depends on the data that is
 *  already in production - which is the shape of the incident. These are what it cannot see:
 *  [destructive] DROP of a constraint, index, trigger, function, view, sequence, extension ...
 *  [rename]     RENAME of anything: the code still running uses the old name during the deploy.
 *  [data-dependent]  ADD COLUMN ... NOT NULL with no DEFAULT; SET NOT NULL; UPDATE with no WHERE;
 *               a UNIQUE index or constraint on a table that already exists. (A table created in the
 *               SAME migration is empty, so its own unique indexes and NOT NULL columns are fine; and a
 *               unique index that includes a column this migration adds with no DEFAULT and no NOT NULL
 *               is fine too - the column is born NULL and NULLs never collide, which is what Prisma
 *               writes for `String? @unique`. A new column WITH a default is not: every old row gets it.)
 *  [environment] CREATE EXTENSION: production may not have it, and an empty CI database cannot say.
 *
 * ALLOWED_DESTRUCTIVE.txt:  one folder name per line; blank lines and `#` comments allowed.
 *   Empty today. Adding a line is a decision for the owner, reviewed in the PR like any other.
 * RELEASED.txt:  a folder joins the list once it has been deployed to a shared database
 *   (production) - not before: until then it may still be fixed in place, and it is still judged by
 *   the review rules. Adding a line to RELEASED.txt is therefore also reviewed with care.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FOLDER_SHAPE = /^(\d{14})_([A-Za-z0-9_]+)$/;
const PIN = /^sha256:([0-9a-f]{64})$/;

const HOW_TO_ALLOW =
  "If the owner approved it on purpose, name the folder in prisma/migrations/ALLOWED_DESTRUCTIVE.txt (one folder name per line).";

// ---------------------------------------------------------------- the hard list

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

// ---------------------------------------------------------------- the review list

/** DROP of an object other than the ones on the hard list. */
const DROPPED_OBJECT =
  /\bDROP\s+(CONSTRAINT|INDEX|TRIGGER|FUNCTION|PROCEDURE|MATERIALIZED\s+VIEW|VIEW|SEQUENCE|DOMAIN|POLICY|RULE|EXTENSION|OWNED|ROLE|USER)\b/i;

const IDENT = String.raw`(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`;

const CREATE_TABLE = new RegExp(
  String.raw`^\s*CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`,
  "i",
);
const ALTER_TABLE = new RegExp(String.raw`^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QNAME})\s+([\s\S]*)$`, "i");
/** `(2)` is the column list, when there is one. */
const CREATE_UNIQUE_INDEX = new RegExp(
  String.raw`^\s*CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:${IDENT}\s+)?ON\s+(?:ONLY\s+)?(${QNAME})\s*(?:USING\s+\w+\s*)?(?:\(([^)]*)\))?`,
  "i",
);

/** `(1)` is the column name, `(2)` the rest of the action (its type and constraints). */
const ADD_COLUMN = new RegExp(
  String.raw`^ADD\s+(?!(?:CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b)(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})\s+([\s\S]*)$`,
  "i",
);
/** What fills a new column for the rows that exist (or forbids NULL in it): such a column is NOT "born NULL". */
const FILLS_OR_FORBIDS_NULL = /\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b|\bDEFAULT\b|\bGENERATED\b|\b(?:SMALL|BIG)?SERIAL\b|\bIDENTITY\b/i;
const ADD_UNIQUE = new RegExp(String.raw`^ADD\s+(?:CONSTRAINT\s+${IDENT}\s+)?(?:UNIQUE|PRIMARY\s+KEY)\b`, "i");
/** The column list of `UNIQUE (a, b)` / `PRIMARY KEY (a, b)` inside an ALTER TABLE action. */
const CONSTRAINT_COLUMNS = /\b(?:UNIQUE|PRIMARY\s+KEY)\s*\(([^)]*)\)/i;
const SET_NOT_NULL = new RegExp(String.raw`^ALTER\s+(?:COLUMN\s+)?${IDENT}\s+SET\s+NOT\s+NULL\b`, "i");
/** `DROP "col"` / `DROP IF EXISTS "col"`: a column dropped without writing COLUMN (DROP COLUMN has its own rule). */
const DROP_BARE_COLUMN = /^DROP\s+(?!COLUMN\b|CONSTRAINT\b)/i;

const tableKey = (raw) => raw.replace(/"/g, "").split(".").pop().toLowerCase();
const collapse = (s) => s.replace(/\s+/g, " ").trim();

/** Split at the commas that are not inside parentheses or a quoted identifier. */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "(") depth += 1;
    else if (!quoted && ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0 && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The actions of an ALTER TABLE (`ADD ..., DROP ..., ALTER ...`). */
const splitActions = splitTopLevel;

/** `"a", b DESC, lower("c")` -> ["a", "b", "lower"]: the leading identifier of each element, unquoted, lower-case. */
function columnNames(list) {
  return splitTopLevel(list ?? "")
    .map((element) => /^\s*("(?:[^"]|"")*"|[A-Za-z_][\w$]*)/.exec(element)?.[1])
    .filter(Boolean)
    .map((ident) => ident.replace(/"/g, "").toLowerCase());
}

// ---------------------------------------------------------------- hashing

/** CRLF read as LF, byte for byte otherwise (a lone CR, a BOM, trailing spaces all still count). */
export function normalizeLineEndings(buf) {
  return Buffer.from(Buffer.from(buf).toString("latin1").replace(/\r\n/g, "\n"), "latin1");
}

/** sha256, hex, of a migration.sql with its line endings normalised: what RELEASED.txt pins. */
export function hashMigrationSql(buf) {
  return createHash("sha256").update(normalizeLineEndings(buf)).digest("hex");
}

// ---------------------------------------------------------------- SQL, read just enough

/**
 * Walk the SQL once and cut it into statements, each in three views:
 *  - `code`: comments removed, everything else untouched. The destructive check reads this one,
 *    so a statement hidden in a DO block or an EXECUTE string is still seen, while
 *    "-- no DROP TABLE here" is not a finding.
 *  - `skeleton`: comments removed AND string / identifier / dollar-quoted bodies blanked, so
 *    the structure (`ALTER TABLE "x" ADD "y" TEXT NOT NULL`) can be read without mistaking a
 *    word inside a string for SQL. The enum rule reads this one.
 *  - `named`: the skeleton, but quoted identifiers kept as written, for the review rules that
 *    need NAMES (which table, which column).
 * A semicolon inside a string, an identifier, a comment or a dollar-quoted body does not split.
 * The final element holds whatever follows the last semicolon (often only a newline).
 */
export function sqlStatements(sql) {
  const statements = [];
  let code = "";
  let skeleton = "";
  let named = "";
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
      named += " ";
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
      named += "''";
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
      named += ident;
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
        named += end === -1 ? tag[0] : `${tag[0]}${tag[0]}`;
        i = stop;
        continue;
      }
    }
    if (ch === ";") {
      statements.push({ code, skeleton, named });
      code = "";
      skeleton = "";
      named = "";
      i += 1;
      continue;
    }
    code += ch;
    skeleton += ch;
    named += ch;
    i += 1;
  }
  statements.push({ code, skeleton, named });
  return statements;
}

/** The two whole-file views (statements joined back with their semicolons). */
export function sqlViews(sql) {
  const statements = sqlStatements(sql);
  return {
    code: statements.map((s) => s.code).join(";"),
    skeleton: statements.map((s) => s.skeleton).join(";"),
  };
}

/**
 * What is in this migration's SQL that needs a decision. Returns `{ tier, rule, label, why }` once
 * per distinct label. `tier` is "hard" (judged in every folder) or "review" (new migrations only).
 */
export function analyseSql(sql) {
  const statements = sqlStatements(sql)
    .map((s) => ({ code: collapse(s.code), skeleton: collapse(s.skeleton), named: collapse(s.named) }))
    .filter((s) => s.skeleton);
  const found = new Map();
  const add = (tier, rule, label, why) => {
    if (!found.has(label)) found.set(label, { tier, rule, label, why });
  };

  // hard: the original blacklist, read over the whole text so a DO block hides nothing
  const wholeCode = statements.map((s) => s.code).join(";\n");
  for (const [label, re] of DESTRUCTIVE) {
    if (re.test(wholeCode)) add("hard", "destructive", label, "Migrations are additive only.");
  }

  // review: objects dropped, renames - also read over the whole text
  const dropped = DROPPED_OBJECT.exec(wholeCode);
  if (dropped) {
    add(
      "review",
      "destructive",
      `DROP ${dropped[1].toUpperCase().replace(/\s+/g, " ")}`,
      "Dropping an object breaks the code that still uses it while the deploy rolls out, and cannot be undone.",
    );
  }
  if (statements.some((s) => /\bRENAME\b/i.test(s.skeleton))) {
    add(
      "review",
      "rename",
      "RENAME",
      "The code that is still running uses the old name during the deploy. Add the new one, copy the data, and remove the old one in a later migration.",
    );
  }

  // review: what depends on the rows that are already there
  //  - a table created in THIS migration is empty, so its own unique indexes and NOT NULL columns are fine;
  //  - a column added in this migration with no default and no NOT NULL is "born NULL" - NULLs never
  //    collide, so a unique index that includes it cannot fail (Prisma writes exactly this for `String? @unique`).
  const created = new Set();
  const bornNull = new Map(); // table -> Set of column names
  for (const s of statements) {
    const m = CREATE_TABLE.exec(s.code);
    if (m) created.add(tableKey(m[1]));
    const alterNamed = ALTER_TABLE.exec(s.named);
    if (!alterNamed) continue;
    for (const action of splitActions(alterNamed[2])) {
      const column = ADD_COLUMN.exec(action);
      if (column && !FILLS_OR_FORBIDS_NULL.test(column[2] ?? "")) {
        const table = tableKey(alterNamed[1]);
        if (!bornNull.has(table)) bornNull.set(table, new Set());
        bornNull.get(table).add(columnNames(column[1])[0]);
      }
    }
  }
  const existing = (raw) => !created.has(tableKey(raw));
  /** True when at least one of these columns of this table was added, born NULL, by this migration. */
  const includesNewNullColumn = (rawTable, list) => {
    const fresh = bornNull.get(tableKey(rawTable));
    return Boolean(fresh) && columnNames(list).some((name) => fresh.has(name));
  };

  for (const s of statements) {
    const alter = ALTER_TABLE.exec(s.named);
    if (alter) {
      const onExistingTable = existing(alter[1]);
      for (const action of splitActions(alter[2])) {
        if (DROP_BARE_COLUMN.test(action)) {
          add("hard", "destructive", "DROP COLUMN (written without the COLUMN keyword)", "Migrations are additive only.");
        }
        if (!onExistingTable) continue;
        const column = ADD_COLUMN.exec(action);
        if (column) {
          const spec = column[2] ?? "";
          const mustHaveValue = /\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b/i.test(spec);
          const fillsItself = /\bDEFAULT\b|\bGENERATED\b|\b(?:SMALL|BIG)?SERIAL\b/i.test(spec);
          if (mustHaveValue && !fillsItself) {
            add(
              "review",
              "data-dependent",
              "ADD COLUMN ... NOT NULL without a DEFAULT",
              "It fails on a table that already has rows, which an empty test database cannot show. Give it a DEFAULT, or add it nullable, backfill, and set NOT NULL in a later migration.",
            );
          }
        }
        if (SET_NOT_NULL.test(action)) {
          add(
            "review",
            "data-dependent",
            "SET NOT NULL",
            "It fails if any existing row holds NULL there, which an empty test database cannot show. Backfill first, in an earlier migration.",
          );
        }
        if (ADD_UNIQUE.test(action) && !includesNewNullColumn(alter[1], CONSTRAINT_COLUMNS.exec(action)?.[1])) {
          add(
            "review",
            "data-dependent",
            "a UNIQUE or PRIMARY KEY constraint on a table that already exists",
            "It fails if existing rows hold duplicates, which an empty test database cannot show. Check the production data first.",
          );
        }
      }
      continue;
    }
    const unique = CREATE_UNIQUE_INDEX.exec(s.named);
    if (unique && existing(unique[1]) && !includesNewNullColumn(unique[1], unique[2])) {
      add(
        "review",
        "data-dependent",
        "CREATE UNIQUE INDEX on a table that already exists",
        "It fails if existing rows hold duplicates, which an empty test database cannot show. Check the production data first.",
      );
    }
    if (/^UPDATE\b/i.test(s.skeleton) && !/\bWHERE\b/i.test(s.skeleton)) {
      add(
        "review",
        "data-dependent",
        "UPDATE without a WHERE",
        "It rewrites every row, which an empty test database cannot show. Say which rows.",
      );
    }
    if (/^CREATE\s+EXTENSION\b/i.test(s.skeleton)) {
      add(
        "review",
        "environment",
        "CREATE EXTENSION",
        "The production server may not have the extension, and an empty CI database cannot say. Run the read-only availability check on production first (SELECT name FROM pg_available_extensions).",
      );
    }
  }
  return [...found.values()];
}

// ---------------------------------------------------------------- the files

/** A list file: one name per line; blank lines and `#` comments ignored. Null when the file is missing. */
function readLines(file) {
  if (!existsSync(file)) return null;
  const lines = [];
  for (const raw of readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line) lines.push(line);
  }
  return lines;
}

/** RELEASED.txt entries: `{ line, name, pin }` where `pin` is the hex hash, `null` when absent, `false` when malformed. */
function readReleased(file) {
  const lines = readLines(file);
  if (lines === null) return null;
  return lines.map((line) => {
    const [name = "", token, ...extra] = line.split(/\s+/);
    if (token === undefined) return { line, name, pin: null };
    const m = PIN.exec(token);
    return { line, name, pin: m && extra.length === 0 ? m[1] : false };
  });
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
  const released = readReleased(join(dir, "RELEASED.txt"));
  const allowedDestructive = new Set(readLines(join(dir, "ALLOWED_DESTRUCTIVE.txt")) ?? []);
  const releasedNames = new Set();
  if (released === null) {
    add(
      "released-file",
      "RELEASED.txt",
      "missing: list every migration folder that has been applied to a shared database, one per line, as `<folder> sha256:<hex>` (node scripts/lint-migrations.mjs --hash prints the lines)",
    );
  } else {
    for (const entry of released) {
      const { name, pin } = entry;
      if (releasedNames.has(name)) add("released-file", "RELEASED.txt", `${name} is listed twice`);
      releasedNames.add(name);
      if (!FOLDER_SHAPE.test(name)) add("released-file", "RELEASED.txt", `"${name}" is not a migration folder name`);

      if (pin === false) {
        add("released-file", "RELEASED.txt", `the line for ${name} is not \`<folder> sha256:<64 lower-case hex>\``);
      } else if (pin === null) {
        add(
          "released-file",
          "RELEASED.txt",
          `${name} has no sha256 pin. Run  node scripts/lint-migrations.mjs --hash ${name}  and paste the line it prints. ` +
            "Without a pin a released migration could be edited without anyone noticing.",
        );
      }

      if (!folders.includes(name)) {
        add(
          "released-missing",
          name,
          "is listed in RELEASED.txt but the folder is gone. A released migration is never renamed or removed - " +
            "the database remembers its name (docs/DEPLOYMENT-INCIDENT-2026-10-19.md). Restore the folder.",
        );
      } else if (typeof pin === "string") {
        const file = join(dir, name, "migration.sql");
        if (existsSync(file) && statSync(file).isFile() && hashMigrationSql(readFileSync(file)) !== pin) {
          add(
            "released-changed",
            name,
            "migration.sql no longer matches the sha256 pinned in RELEASED.txt. A released migration is never edited - " +
              "it already ran in production with its old text. Restore the file and put the change in a NEW migration.",
          );
        }
      }
    }
    const releasedTs = [...releasedNames].map((n) => FOLDER_SHAPE.exec(n)?.[1]).filter(Boolean).sort();
    const lastReleased = releasedTs.length > 0 ? releasedTs[releasedTs.length - 1] : null;
    if (lastReleased) {
      for (const name of folders) {
        if (releasedNames.has(name)) continue;
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

    if (!allowedDestructive.has(name)) {
      const isReleased = releasedNames.has(name);
      for (const f of analyseSql(sql)) {
        if (f.tier === "review" && isReleased) continue; // frozen by its pin
        add(f.rule, `${name}/migration.sql`, `contains ${f.label}. ${f.why} ${HOW_TO_ALLOW}`);
      }
    }

    const statements = sqlViews(sql)
      .skeleton.split(";")
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

/** `YYYYMMDDHHMMSS` -> true when it is a plausible calendar date and time. */
function plausibleTimestamp(ts) {
  const month = Number(ts.slice(4, 6));
  const day = Number(ts.slice(6, 8));
  const hour = Number(ts.slice(8, 10));
  const minute = Number(ts.slice(10, 12));
  const second = Number(ts.slice(12, 14));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 59;
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const flags = args.filter((a) => a.startsWith("--"));
  const positional = args.filter((a) => !a.startsWith("--"));
  const hashMode = flags.includes("--hash");
  const dirFlag = flags.find((a) => a.startsWith("--dir="));
  const dirArg = dirFlag ? dirFlag.slice("--dir=".length) : hashMode ? join("prisma", "migrations") : (positional[0] ?? join("prisma", "migrations"));
  const dir = resolve(process.cwd(), dirArg);

  if (hashMode) {
    let names;
    try {
      const all = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      names = positional.length > 0 ? positional : all;
      for (const name of names) {
        if (!all.includes(name)) throw new Error(`no such migration folder: ${name}`);
      }
      const lines = names.map((name) => `${name} sha256:${hashMigrationSql(readFileSync(join(dir, name, "migration.sql")))}`);
      process.stdout.write(`${lines.join("\n")}\n`);
    } catch (err) {
      console.error(`lint-migrations: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
    return;
  }

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
