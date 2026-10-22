import { randomInt } from "node:crypto";

/** Any string-keyed environment (process.env, or a plain object in a test). */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Safety rules for `prisma/seed.ts`, kept apart from it so they can be unit
 * tested without a database (tests/seed-guard.test.ts).
 *
 * The seed creates a login. This repository is public, so that login must never
 * have a password anyone can read here, and the seed must never run against a
 * production database by accident (a laptop with the production DATABASE_URL in
 * its .env is enough).
 */

export const DEFAULT_SEED_OWNER_EMAIL = "owner@zaki.local";

/** The demo owner's username (stored lower-case, like every username: sign-in lower-cases what is typed). */
export const DEFAULT_SEED_OWNER_USERNAME = "owner";

/** Same rule the application enforces for every account (src/server/validation.ts). */
const PASSWORD_MIN = 8;

/** Database hosts that mean "this machine / this compose project". */
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal", "db", "postgres"]);

function databaseHost(env: Env): string | null {
  const raw = env["DATABASE_URL"];
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Throws when the seed must not run:
 *  - NODE_ENV=production (the Docker image sets it), or
 *  - DATABASE_URL points at a host that is not this machine,
 * unless ALLOW_PROD_SEED=1 says the operator means it.
 */
export function assertSeedAllowed(env: Env = process.env): void {
  if (env["ALLOW_PROD_SEED"] === "1") return;

  if (env["NODE_ENV"] === "production") {
    throw new Error(
      "Refusing to seed: NODE_ENV=production. The seed creates a demo owner login; " +
        "set ALLOW_PROD_SEED=1 only if you really mean to seed this database.",
    );
  }
  const host = databaseHost(env);
  if (host && !LOCAL_DB_HOSTS.has(host) && !host.endsWith(".localhost")) {
    throw new Error(
      `Refusing to seed: DATABASE_URL points at "${host}", which is not this machine. ` +
        "Set ALLOW_PROD_SEED=1 only if that database is disposable or you really mean it.",
    );
  }
}

export function resolveOwnerEmail(env: Env = process.env): string {
  const email = (env["SEED_OWNER_EMAIL"] ?? "").trim().toLowerCase();
  return email || DEFAULT_SEED_OWNER_EMAIL;
}

/** Throws a message naming the first rule the password breaks; returns it unchanged otherwise. */
export function assertStrongEnough(password: string): string {
  if (password.length < PASSWORD_MIN) throw new Error(`SEED_OWNER_PASSWORD must be at least ${PASSWORD_MIN} characters.`);
  if (!/[A-Za-z]/.test(password)) throw new Error("SEED_OWNER_PASSWORD must contain a letter.");
  if (!/[0-9]/.test(password)) throw new Error("SEED_OWNER_PASSWORD must contain a digit.");
  return password;
}

// No look-alikes (0/O, 1/l/I): the password is printed once and has to be read off a terminal.
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";

/** A random password that satisfies the application's policy (letters and digits, 20 characters). */
export function generatePassword(length = 20): string {
  const alphabet = LETTERS + DIGITS;
  const chars: string[] = [];
  // One of each class first, so the policy is met by construction, not by luck.
  chars.push(LETTERS[randomInt(LETTERS.length)] as string);
  chars.push(DIGITS[randomInt(DIGITS.length)] as string);
  while (chars.length < length) chars.push(alphabet[randomInt(alphabet.length)] as string);
  // Fisher-Yates, so the two guaranteed characters are not always first.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join("");
}

/** SEED_OWNER_PASSWORD when set (and strong enough), otherwise a fresh random one. */
export function resolveOwnerPassword(env: Env = process.env): { password: string; generated: boolean } {
  const provided = env["SEED_OWNER_PASSWORD"];
  if (provided) return { password: assertStrongEnough(provided), generated: false };
  return { password: generatePassword(), generated: true };
}
