/**
 * Re-encrypts integration secrets that are still in the legacy format (key derived from
 * AUTH_SECRET) into the v2 format (key derived from ENCRYPTION_KEY), so that rotating
 * AUTH_SECRET can never again brick the stored Telegram / n8n / Google secrets.
 *
 *   npx tsx scripts/reencrypt-secrets.ts                     dry run (the default): counts, writes nothing
 *   npx tsx scripts/reencrypt-secrets.ts --apply             write
 *   npx tsx scripts/reencrypt-secrets.ts --apply --org=<id>  only one organisation (try one first)
 *
 * Needs, in the environment: DATABASE_URL, AUTH_SECRET (reads the legacy rows) and
 * ENCRYPTION_KEY (writes the v2 rows; `openssl rand -hex 32`).
 *
 * Safe to re-run: v2 rows are left alone. A row it cannot read is counted and left exactly
 * as it was. Each write is conditional on the row still holding what was read, so a
 * concurrent change (e.g. a Google token refresh) is skipped, never overwritten.
 * Exit code: 0 ok, 1 refused to run, 2 finished but some rows were unreadable.
 *
 * It prints counts only - never a secret, a ciphertext, a key or a credential.
 */
import { db } from "@/server/db";
import { decryptSecrets, encryptSecrets, encryptionKeyConfigured, isV2Ciphertext } from "@/server/crypto";

export interface ReencryptSummary {
  /** Rows that hold a secret. */
  scanned: number;
  /** Readable with the AUTH_SECRET key: the rows to upgrade. */
  legacy: number;
  /** Rewritten as v2 (always 0 in a dry run). */
  migrated: number;
  /** Already v2 and readable with ENCRYPTION_KEY. */
  alreadyV2: number;
  /** Not readable with the key they should be (left untouched). */
  unreadable: number;
  /** Changed by someone else between reading and writing (left as they now are). */
  skipped: number;
}

export interface ReencryptOptions {
  apply: boolean;
  /** Only this organisation. */
  orgId?: string;
  /** Test seam: awaited after a row has been read and before it is written (lets a test play a concurrent writer). */
  beforeWrite?: (rowId: string) => Promise<void>;
}

export async function reencryptSecrets(opts: ReencryptOptions): Promise<ReencryptSummary> {
  if (!encryptionKeyConfigured()) {
    throw new Error("ENCRYPTION_KEY is not set: there is no key to re-encrypt the secrets with");
  }
  const rows = await db.integration.findMany({
    where: { secretEnc: { not: null }, ...(opts.orgId ? { orgId: opts.orgId } : {}) },
    select: { id: true, secretEnc: true },
    orderBy: { createdAt: "asc" },
  });

  const summary: ReencryptSummary = { scanned: 0, legacy: 0, migrated: 0, alreadyV2: 0, unreadable: 0, skipped: 0 };
  for (const row of rows) {
    const stored = row.secretEnc;
    if (!stored) continue;
    summary.scanned += 1;

    const plain = decryptSecrets<unknown>(stored);
    if (plain === null) {
      summary.unreadable += 1;
      continue;
    }
    if (isV2Ciphertext(stored)) {
      summary.alreadyV2 += 1;
      continue;
    }

    summary.legacy += 1;
    const upgraded = encryptSecrets(plain); // v2: ENCRYPTION_KEY is set (checked above)
    // The new blob must read back to exactly the same secrets before it may replace the old one.
    if (!isV2Ciphertext(upgraded) || JSON.stringify(decryptSecrets<unknown>(upgraded)) !== JSON.stringify(plain)) {
      throw new Error("verification failed: a re-encrypted secret did not read back identically; nothing further was written");
    }
    if (!opts.apply) continue;

    await opts.beforeWrite?.(row.id);
    const written = await db.integration.updateMany({ where: { id: row.id, secretEnc: stored }, data: { secretEnc: upgraded } });
    if (written.count === 1) summary.migrated += 1;
    else summary.skipped += 1;
  }
  return summary;
}

const USAGE = [
  "Usage: npx tsx scripts/reencrypt-secrets.ts [--apply] [--org=<organizationId>]",
  "  (default)    dry run: counts what would change and writes nothing",
  "  --apply      re-encrypt the legacy secrets as v2",
  "  --org=<id>   only this organisation",
];

/** host:port/database of DATABASE_URL, so the operator sees where it runs; never the credentials. */
function databaseTarget(): string {
  try {
    const u = new URL(process.env["DATABASE_URL"] ?? "");
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "unknown";
  }
}

/** The command line, with its output injectable. Returns the exit code. */
export async function runCli(argv: string[], print: (line: string) => void = (line) => console.log(line)): Promise<number> {
  const apply = argv.includes("--apply");
  const orgArg = argv.find((a) => a.startsWith("--org="));
  const orgId = orgArg ? orgArg.slice("--org=".length) : undefined;
  const unknown = argv.filter((a) => a !== "--apply" && !a.startsWith("--org="));
  if (unknown.length > 0 || orgArg === "--org=") {
    print(`unknown or incomplete option: ${[...unknown, ...(orgArg === "--org=" ? [orgArg] : [])].join(" ")}`);
    USAGE.forEach(print);
    return 1;
  }
  if (!encryptionKeyConfigured()) {
    print("ENCRYPTION_KEY is not set: there is no key to re-encrypt the secrets with (openssl rand -hex 32).");
    return 1;
  }
  if (!process.env["AUTH_SECRET"]) {
    print("AUTH_SECRET is not set: it is needed to read the legacy secrets.");
    return 1;
  }

  let summary: ReencryptSummary;
  try {
    summary = await reencryptSecrets({ apply, orgId });
  } catch (err) {
    // the message of our own errors names a variable, never its value
    print(`failed: ${err instanceof Error ? err.message.split("\n")[0]!.slice(0, 200) : "unknown error"}`);
    return 1;
  }

  print(apply ? "mode: APPLY" : "mode: DRY RUN - nothing is written");
  print(`database: ${databaseTarget()}`);
  print(`scope: ${orgId ? "one organisation" : "all organisations"}`);
  print(`rows with a secret: ${summary.scanned}`);
  print(`  legacy (AUTH_SECRET key): ${summary.legacy}${apply ? "" : " -> would be re-encrypted"}`);
  if (apply) print(`  re-encrypted now: ${summary.migrated}`);
  print(`  already v2: ${summary.alreadyV2}`);
  print(`  unreadable (left untouched): ${summary.unreadable}`);
  print(`  skipped (changed meanwhile): ${summary.skipped}`);
  if (!apply && summary.legacy > 0) print("Re-run with --apply to write.");
  if (summary.unreadable > 0) print("WARNING: some secrets cannot be read with the current keys; those integrations must be reconnected.");
  return summary.unreadable > 0 ? 2 : 0;
}

async function main(): Promise<void> {
  const code = await runCli(process.argv.slice(2));
  await db.$disconnect();
  process.exit(code);
}

// Run only when started as a script (`npx tsx scripts/reencrypt-secrets.ts`), never when imported by a test.
if (/reencrypt-secrets\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  void main();
}
