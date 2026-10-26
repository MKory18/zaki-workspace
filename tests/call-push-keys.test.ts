import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { vapidKeys } from "@/server/calls/push";

describe("the keys that ring a closed site need no new setting", () => {
  it("are derived from the server's secret: the same every time, a valid P-256 pair", () => {
    const env = { AUTH_SECRET: "a-secret-of-at-least-sixteen" } as unknown as NodeJS.ProcessEnv;
    const a = vapidKeys(env);
    expect(vapidKeys(env)).toEqual(a);
    expect(Buffer.from(a.publicKey, "base64url")).toHaveLength(65); // uncompressed point
    expect(Buffer.from(a.privateKey, "base64url")).toHaveLength(32);
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(a.privateKey, "base64url"));
    expect(ecdh.getPublicKey().toString("base64url")).toBe(a.publicKey);
  });

  it("follow ENCRYPTION_KEY when it is set (it outlives a changed AUTH_SECRET), and differ per secret", () => {
    const one = vapidKeys({ AUTH_SECRET: "x".repeat(20), ENCRYPTION_KEY: "k".repeat(40) } as unknown as NodeJS.ProcessEnv);
    const two = vapidKeys({ AUTH_SECRET: "y".repeat(20), ENCRYPTION_KEY: "k".repeat(40) } as unknown as NodeJS.ProcessEnv);
    const three = vapidKeys({ AUTH_SECRET: "x".repeat(20) } as unknown as NodeJS.ProcessEnv);
    expect(one).toEqual(two);
    expect(one.publicKey).not.toBe(three.publicKey);
  });

  it("pinned keys in the environment win", () => {
    expect(vapidKeys({ AUTH_SECRET: "x".repeat(20), VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" } as unknown as NodeJS.ProcessEnv)).toEqual({ publicKey: "pub", privateKey: "priv" });
  });
});
