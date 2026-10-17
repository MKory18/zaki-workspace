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
    const tampered = token.replace(/.$/, token.slice(-1) === "a" ? "b" : "a");
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
