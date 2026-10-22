import { SignJWT } from "jose";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySessionToken, createSessionToken } from "@/server/session";
import { env } from "@/server/env";

describe("session tokens", () => {
  it("round-trips the user and the session version", async () => {
    const token = await createSessionToken({ userId: "user_123", tv: 4 });
    expect(await verifySessionToken(token)).toEqual({ userId: "user_123", tv: 4 });
  });

  it("carries the onboarding flags the Edge middleware reads", async () => {
    const token = await createSessionToken({ userId: "u", tv: 0, mcp: true, tp: true });
    expect(await verifySessionToken(token)).toEqual({ userId: "u", tv: 0, mcp: true, tp: true });
    const plain = await createSessionToken({ userId: "u", tv: 0 });
    expect(await verifySessionToken(plain)).toEqual({ userId: "u", tv: 0 });
  });

  it("rejects tampered tokens", async () => {
    const token = await createSessionToken({ userId: "user_123", tv: 0 });
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

  it("refuses a token without a session version (every token issued before this existed: one sign-in after the release)", async () => {
    const key = createHash("sha256").update(env().AUTH_SECRET).digest();
    const legacy = await new SignJWT({ userId: "user_123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);
    expect(await verifySessionToken(legacy)).toBeNull();
  });

  it("refuses a non-integer or negative session version", async () => {
    const key = createHash("sha256").update(env().AUTH_SECRET).digest();
    for (const tv of ["3", 1.5, -1, null]) {
      const t = await new SignJWT({ userId: "u", tv: tv as never })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(key);
      expect(await verifySessionToken(t), String(tv)).toBeNull();
    }
  });

  it("validates env at startup", () => {
    // env() was loaded in tests/setup.ts with valid values
    expect(() => env()).not.toThrow();
    expect(env().AUTH_SECRET.length).toBeGreaterThan(15);
  });
});
