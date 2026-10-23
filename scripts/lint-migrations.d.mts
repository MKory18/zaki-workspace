export interface MigrationProblem {
  rule: string;
  where: string;
  message: string;
}

export interface MigrationLintResult {
  problems: MigrationProblem[];
  migrations: number;
  released: number;
}

/** One finding in a migration's SQL: `tier` "hard" is judged in every folder, "review" in new ones only. */
export interface SqlFinding {
  tier: "hard" | "review";
  rule: "destructive" | "rename" | "data-dependent" | "environment";
  label: string;
  why: string;
}

/** Lint a Prisma migrations directory (see scripts/lint-migrations.mjs for the rules). */
export function lintMigrations(dir: string): MigrationLintResult;

/** What in this SQL needs a decision, once per distinct label. */
export function analyseSql(sql: string): SqlFinding[];

/** sha256 (hex) of a migration.sql with CRLF read as LF - what RELEASED.txt pins. */
export function hashMigrationSql(buf: Uint8Array): string;

/** The bytes with every CRLF turned into LF (nothing else changes). */
export function normalizeLineEndings(buf: Uint8Array): Buffer;

/**
 * The SQL cut into statements, each in three views: `code` (comments removed), `skeleton` (strings,
 * identifiers and dollar-quoted bodies blanked too) and `named` (the skeleton with quoted identifiers kept).
 * The last element holds whatever follows the last semicolon.
 */
export function sqlStatements(sql: string): Array<{ code: string; skeleton: string; named: string }>;

/** SQL with comments removed (`code`) and with strings/identifiers/dollar-quoted bodies blanked too (`skeleton`). */
export function sqlViews(sql: string): { code: string; skeleton: string };
