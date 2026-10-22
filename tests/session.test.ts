import { describe, expect, it } from "vitest";
import { verifySessionToken, createSessionToken } from "@/server/session";
import { env } from "@/server/env";

describe("session tokens", () => {
  it("round-trips a userId", async () => {
    const token = await createSessionToken("user_123");
    const session = await verifySessionToken(token);
    expect(session).toEqual({ userId: "user_123" });
  });

  it("rejects tampered tokens", async () => {
    const token = await createSessionToken("user_123");
    // Flip a character in the MIDDLE of the signature. (The last base64url char of a
    // 32-byte signature carries only 4 real bits, so swapping it can decode to the
    // same bytes and the token would still verify — that made this test flaky.)
    const [header, payload, signature] = token.split(".") as [string, string, string];
    const flipped = signature[10] === "a" ? "b" : "a";
    const tampered = `${header}.${payload}.${signature.slice(0, 10)}${flipped}${signature.slice(11)}`;
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("rejects empty strings", async () => {
    expect(await verifySessionToken("")).toBeNull();
  });

  it("validates env at startup", () => {
    // env() was loaded in tests/setup.ts with valid values
    expect(() => env()).not.toThrow();
    expect(env().AUTH_SECRET.length).toBeGreaterThan(15);
  });
});
