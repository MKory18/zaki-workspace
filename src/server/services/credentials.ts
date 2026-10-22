import { randomInt } from "node:crypto";
import { z } from "zod";

/**
 * Account credentials as pure functions (no database): what a username may look like, the
 * password policy, and the temporary passwords the owner hands to a new or reset account.
 * Errors are machine keys (src/lib/i18n/ar.accounts.json has the Arabic text).
 */

// ---------- usernames ----------

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
/** Lower-case latin letters, digits, dot, underscore, hyphen; the first character a letter or digit. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** The one stored form of a username: no surrounding spaces, lower-case ("Ahmad.K" is "ahmad.k"). */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const usernameSchema = z
  .string({ invalid_type_error: "accounts.username_invalid" })
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .min(USERNAME_MIN, "accounts.username_too_short")
      .max(USERNAME_MAX, "accounts.username_too_long")
      .regex(USERNAME_PATTERN, "accounts.username_invalid"),
  );

// ---------- passwords ----------

/** The password policy: 8 characters or more, at least one latin letter and one digit. */
export const passwordSchema = z
  .string({ invalid_type_error: "accounts.password_min8" })
  .min(8, "accounts.password_min8")
  .max(200, "accounts.password_too_long")
  .regex(/[A-Za-z]/, "accounts.password_letter")
  .regex(/[0-9]/, "accounts.password_digit");

/**
 * A temporary password is read off the owner's phone and typed by somebody else, so it has no
 * look-alikes: no 0/O, no 1/l/I.
 */
export const TEMP_PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyz" + "ABCDEFGHJKLMNPQRSTUVWXYZ" + "23456789";
export const TEMP_PASSWORD_LENGTH = 12;

/**
 * 12 characters drawn with `crypto.randomInt` (uniform, no modulo bias; never Math.random).
 * A candidate without a letter or without a digit is drawn again, so every result passes the
 * password policy and all valid results stay equally likely (~70 bits).
 */
export function generateTemporaryPassword(): string {
  for (;;) {
    let candidate = "";
    for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
      candidate += TEMP_PASSWORD_ALPHABET.charAt(randomInt(TEMP_PASSWORD_ALPHABET.length));
    }
    if (/[A-Za-z]/.test(candidate) && /[0-9]/.test(candidate)) return candidate;
  }
}
