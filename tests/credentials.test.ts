import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Account credentials (src/server/services/credentials.ts): pure, no database.
 *
 * `node:crypto` is wrapped so the tests can prove WHERE the randomness of a temporary password
 * comes from: every call goes to the real `randomInt` unless a test scripts the next values.
 */
const scripted = vi.hoisted((): number[] => []);
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  const randomInt = vi.fn((max: number) => (scripted.length ? (scripted.shift() as number) : real.randomInt(max)));
  return { ...real, randomInt, default: { ...real, randomInt } };
});

import { randomInt } from "node:crypto";
import {
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
  generateTemporaryPassword,
  normalizeUsername,
  passwordSchema,
  usernameSchema,
} from "@/server/services/credentials";

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }): string | undefined {
  return result.success ? undefined : result.error?.issues[0]?.message;
}

afterEach(() => {
  scripted.length = 0;
  vi.restoreAllMocks();
});

describe("usernames", () => {
  it("are stored trimmed and lower-case (Ahmad.K and ahmad.k are the same name)", () => {
    expect(normalizeUsername("  Ahmad.K ")).toBe("ahmad.k");
    expect(usernameSchema.parse("Ahmad.K")).toBe("ahmad.k");
    expect(usernameSchema.parse("  SAMI_99  ")).toBe("sami_99");
  });

  it("accept 3 to 32 lower-case latin letters, digits, dot, underscore and hyphen, starting with a letter or digit", () => {
    for (const ok of ["abc", "ahmad", "a.b", "sami_99", "x-1", "7up", "a".repeat(32), "warehouse.2"]) {
      expect(usernameSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("refuse anything else, each with its own machine key", () => {
    expect(firstMessage(usernameSchema.safeParse("ab"))).toBe("accounts.username_too_short");
    expect(firstMessage(usernameSchema.safeParse(""))).toBe("accounts.username_too_short");
    expect(firstMessage(usernameSchema.safeParse("a".repeat(33)))).toBe("accounts.username_too_long");
    for (const bad of [".ahmad", "_x12", "-abc", "ahmad k", "أحمد", "a@b.co", "sami!", "ali/2"]) {
      expect(firstMessage(usernameSchema.safeParse(bad)), bad).toBe("accounts.username_invalid");
    }
    expect(usernameSchema.safeParse(12345).success).toBe(false);
  });
});

describe("the password policy", () => {
  it("is at least 8 characters with a letter and a digit", () => {
    expect(passwordSchema.safeParse("abcdefg1").success).toBe(true);
    expect(firstMessage(passwordSchema.safeParse("abc1"))).toBe("accounts.password_min8");
    expect(firstMessage(passwordSchema.safeParse("abcdefgh"))).toBe("accounts.password_digit");
    expect(firstMessage(passwordSchema.safeParse("12345678"))).toBe("accounts.password_letter");
    expect(firstMessage(passwordSchema.safeParse(`a1${"x".repeat(199)}`))).toBe("accounts.password_too_long");
  });
});

describe("temporary passwords", () => {
  it("use an alphabet without look-alikes (no 0 O 1 l I) and without repeats", () => {
    for (const ambiguous of ["0", "O", "1", "l", "I"]) expect(TEMP_PASSWORD_ALPHABET).not.toContain(ambiguous);
    expect(new Set(TEMP_PASSWORD_ALPHABET).size).toBe(TEMP_PASSWORD_ALPHABET.length);
    expect(TEMP_PASSWORD_LENGTH).toBe(12);
  });

  it("are 12 characters of that alphabet, always with a letter and a digit, and pass the password policy", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toHaveLength(12);
      expect([...pw].every((c) => TEMP_PASSWORD_ALPHABET.includes(c)), pw).toBe(true);
      expect(/[A-Za-z]/.test(pw) && /[0-9]/.test(pw), pw).toBe(true);
      expect(passwordSchema.safeParse(pw).success, pw).toBe(true);
      seen.add(pw);
    }
    // 57^12 possibilities: two equal ones in 2000 draws would mean the source is not random
    expect(seen.size).toBe(2000);
  });

  it("draw every character from crypto.randomInt and never from Math.random", () => {
    const mathRandom = vi.spyOn(Math, "random");
    const draws = vi.mocked(randomInt).mock.calls.length;
    generateTemporaryPassword();
    expect(mathRandom).not.toHaveBeenCalled();
    expect(vi.mocked(randomInt).mock.calls.length - draws).toBeGreaterThanOrEqual(12);
    for (const call of vi.mocked(randomInt).mock.calls.slice(draws)) expect(call[0]).toBe(TEMP_PASSWORD_ALPHABET.length);
  });

  it("map each draw onto the alphabet, and draw again when a candidate lacks a digit or a letter", () => {
    const last = TEMP_PASSWORD_ALPHABET.length - 1; // the digit 9
    scripted.push(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, last);
    expect(generateTemporaryPassword()).toBe("abcdefghijk9");

    // first candidate: twelve times "a" (no digit); second: twelve times "9" (no letter); third is fine
    scripted.push(...Array(12).fill(0), ...Array(12).fill(last), 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, last);
    expect(generateTemporaryPassword()).toBe("abcdefghijk9");
    expect(scripted).toHaveLength(0);
  });
});
