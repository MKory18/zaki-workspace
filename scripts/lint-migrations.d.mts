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

/** Lint a Prisma migrations directory (see scripts/lint-migrations.mjs for the rules). */
export function lintMigrations(dir: string): MigrationLintResult;

/** SQL with comments removed (`code`) and with strings/identifiers/dollar-quoted bodies blanked too (`skeleton`). */
export function sqlViews(sql: string): { code: string; skeleton: string };
