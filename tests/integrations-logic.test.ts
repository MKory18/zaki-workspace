import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecrets, encryptSecrets, generateSharedSecret, hmacHex, safeEqual } from "../src/server/crypto";
import { normalizeUpdate } from "../src/server/services/telegram";
import { N8N_EVENTS, isN8nEvent } from "../src/server/services/n8n";
import { signState, verifyState } from "../src/server/services/google";

describe("crypto secrets", () => {
  it("roundtrips a JSON payload through AES-256-GCM", () => {
    const blob = encryptSecrets({ botToken: "123:abc-def", extra: true });
    expect(blob).not.toContain("123:abc-def");
    const out = decryptSecrets<{ botToken: string; extra: boolean }>(blob);
    expect(out?.botToken).toBe("123:abc-def");
    expect(out?.extra).toBe(true);
  });

  it("returns null on tampered ciphertext or bad shape", () => {
    const blob = encryptSecrets({ sharedSecret: "s" });
    expect(decryptSecrets<Record<string, string>>(null)).toBeNull();
    expect(decryptSecrets<Record<string, string>>("garbage")).toBeNull();
    // flip one byte inside the ciphertext → auth-tag mismatch
    const [iv, data, tag] = blob.split(".");
    expect(iv).toBeDefined();
    expect(data).toBeDefined();
    expect(tag).toBeDefined();
    const flipped = [iv!, (data!.startsWith("B") ? "A" : "B") + data!.slice(1), tag!].join(".");
    expect(decryptSecrets<Record<string, string>>(flipped)).toBeNull();
  });

  it("signs deterministically with HMAC-SHA256", () => {
    const sig = hmacHex("secret", JSON.stringify({ event: "task.created" }));
    expect(sig).toBe(hmacHex("secret", JSON.stringify({ event: "task.created" })));
    expect(sig).toHaveLength(64);
    expect(sig).not.toBe(hmacHex("other", JSON.stringify({ event: "task.created" })));
  });

  it("safeEqual fails silently on differing values and lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

/** Sets/removes env vars for one test and puts the originals back afterwards. */
function envScope(names: string[]) {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const n of names) saved.set(n, process.env[n]);
  });
  afterEach(() => {
    for (const n of names) {
      const v = saved.get(n);
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  });
  return (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

describe("crypto secrets: ENCRYPTION_KEY separation (v2)", () => {
  const set = envScope(["ENCRYPTION_KEY", "AUTH_SECRET"]);
  const KEY = "9f2b7c41d8e65a03b1c4f7e2a9d60853c1e4b7a2f9d0c3e6b5a8d1f4e7c0a3b6";
  const OTHER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const PAYLOAD = { botToken: "123456:AAfake_bot_token_for_the_tests_0123456789abc", sharedSecret: "s" };

  beforeEach(() => set({ ENCRYPTION_KEY: undefined }));

  it("without ENCRYPTION_KEY new ciphertexts keep the legacy shape (no version prefix)", () => {
    const blob = encryptSecrets(PAYLOAD);
    expect(blob).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(blob.startsWith("v2:")).toBe(false);
  });

  it("an empty ENCRYPTION_KEY (compose passes unset variables as '') counts as unset", () => {
    set({ ENCRYPTION_KEY: "" });
    expect(encryptSecrets(PAYLOAD).startsWith("v2:")).toBe(false);
  });

  it("with ENCRYPTION_KEY new ciphertexts are v2:-prefixed and round-trip", () => {
    set({ ENCRYPTION_KEY: KEY });
    const blob = encryptSecrets(PAYLOAD);
    expect(blob.startsWith("v2:")).toBe(true);
    expect(blob).not.toContain("AAfake_bot_token");
    expect(decryptSecrets<typeof PAYLOAD>(blob)).toEqual(PAYLOAD);
    // a fresh IV every time
    expect(encryptSecrets(PAYLOAD)).not.toBe(blob);
  });

  it("a legacy ciphertext written before ENCRYPTION_KEY existed still decrypts after it is set", () => {
    const legacy = encryptSecrets(PAYLOAD);
    set({ ENCRYPTION_KEY: KEY });
    expect(legacy.startsWith("v2:")).toBe(false);
    expect(decryptSecrets<typeof PAYLOAD>(legacy)).toEqual(PAYLOAD);
  });

  it("v2 survives an AUTH_SECRET rotation (that is the point); a legacy blob does not", () => {
    const legacy = encryptSecrets(PAYLOAD);
    set({ ENCRYPTION_KEY: KEY });
    const v2 = encryptSecrets(PAYLOAD);
    set({ AUTH_SECRET: "rotated-auth-secret-0123456789abcdef" });
    expect(decryptSecrets<typeof PAYLOAD>(v2)).toEqual(PAYLOAD);
    expect(decryptSecrets(legacy)).toBeNull();
  });

  it("v2 needs the very same ENCRYPTION_KEY: not readable without it or with another", () => {
    set({ ENCRYPTION_KEY: KEY });
    const v2 = encryptSecrets(PAYLOAD);
    set({ ENCRYPTION_KEY: undefined });
    expect(decryptSecrets(v2)).toBeNull();
    set({ ENCRYPTION_KEY: OTHER_KEY });
    expect(decryptSecrets(v2)).toBeNull();
    set({ ENCRYPTION_KEY: KEY });
    expect(decryptSecrets<typeof PAYLOAD>(v2)).toEqual(PAYLOAD);
  });

  it("the AUTH_SECRET alone cannot open a v2 blob, even with the prefix stripped", () => {
    set({ ENCRYPTION_KEY: KEY });
    const v2 = encryptSecrets(PAYLOAD);
    expect(decryptSecrets(v2.slice(3))).toBeNull();
  });

  it("rejects tampering with any part of a v2 blob", () => {
    set({ ENCRYPTION_KEY: KEY });
    const v2 = encryptSecrets(PAYLOAD);
    const [iv, data, tag] = v2.slice(3).split(".") as [string, string, string];
    const flip = (s: string) => (s.startsWith("B") ? "A" : "B") + s.slice(1);
    const cases: Record<string, string> = {
      "flipped iv": `v2:${flip(iv)}.${data}.${tag}`,
      "flipped data": `v2:${iv}.${flip(data)}.${tag}`,
      "flipped tag": `v2:${iv}.${data}.${flip(tag)}`,
      "truncated tag": `v2:${iv}.${data}.${tag.slice(0, 8)}`,
      "extended tag": `v2:${iv}.${data}.${tag}AAAA`,
      "missing part": `v2:${iv}.${data}`,
      "extra part": `v2:${iv}.${data}.${tag}.${tag}`,
      "other version": `v3:${iv}.${data}.${tag}`,
      "upper-case prefix": `V2:${iv}.${data}.${tag}`,
      "empty body": "v2:",
    };
    for (const [name, blob] of Object.entries(cases)) {
      expect(decryptSecrets(blob), name).toBeNull();
    }
    expect(decryptSecrets<typeof PAYLOAD>(v2)).toEqual(PAYLOAD);
  });

  it("an ENCRYPTION_KEY shorter than 32 characters is a misconfiguration: writing refuses, v2 cannot be read, legacy still can", () => {
    const legacy = encryptSecrets(PAYLOAD);
    set({ ENCRYPTION_KEY: KEY });
    const v2 = encryptSecrets(PAYLOAD);
    set({ ENCRYPTION_KEY: "too-short-key" });
    expect(() => encryptSecrets(PAYLOAD)).toThrow(/ENCRYPTION_KEY/);
    expect(decryptSecrets(v2)).toBeNull();
    expect(decryptSecrets<typeof PAYLOAD>(legacy)).toEqual(PAYLOAD);
  });
});

describe("generateSharedSecret", () => {
  it("is 256 random bits as 64 hex characters, different every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const s = generateSharedSecret();
      expect(s).toMatch(/^[0-9a-f]{64}$/);
      seen.add(s);
    }
    expect(seen.size).toBe(50);
  });

  it("never touches Math.random (it is not a CSPRNG)", () => {
    const spy = vi.spyOn(Math, "random");
    try {
      generateSharedSecret();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("safeEqual (constant time, any length)", () => {
  it("is exact for empty, unicode and prefix-sharing strings", () => {
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "a")).toBe(false);
    expect(safeEqual("مفتاح-سري", "مفتاح-سري")).toBe(true);
    expect(safeEqual("مفتاح-سري", "مفتاح-سرى")).toBe(false);
    expect(safeEqual("secret", "secret ")).toBe(false);
    expect(safeEqual("secret-long-value", "secret")).toBe(false);
  });
});

describe("env: ENCRYPTION_KEY", () => {
  const set = envScope(["ENCRYPTION_KEY"]);

  async function loadEnv(value: string | undefined) {
    vi.resetModules();
    set({ ENCRYPTION_KEY: value });
    return (await import("../src/server/env")).env;
  }

  it("is optional: absent, empty or blank means 'not configured'", async () => {
    expect((await loadEnv(undefined))().ENCRYPTION_KEY).toBeUndefined();
    expect((await loadEnv(""))().ENCRYPTION_KEY).toBeUndefined();
    expect((await loadEnv("   "))().ENCRYPTION_KEY).toBeUndefined();
  });

  it("accepts a key of 32 characters or more and exposes it", async () => {
    const key = "k".repeat(32);
    expect((await loadEnv(key))().ENCRYPTION_KEY).toBe(key);
    const hex = "0123456789abcdef".repeat(4);
    expect((await loadEnv(hex))().ENCRYPTION_KEY).toBe(hex);
  });

  it("refuses a key shorter than 32 characters, naming the variable but never echoing the value", async () => {
    const short = "s3cr3t-but-only-31-characters--"; // 31
    expect(short).toHaveLength(31);
    const env = await loadEnv(short);
    let message = "";
    try {
      env();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/ENCRYPTION_KEY/);
    expect(message).not.toContain(short);
  });
});

describe("telegram normalizeUpdate", () => {
  it("maps a private-chat user message (title from first_name)", () => {
    const n = normalizeUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        date: 1700000000,
        text: "hello",
        chat: { id: 555, first_name: "Salma", username: "salma", type: "private" },
        from: { id: 777, first_name: "Salma", last_name: "K" },
      },
    });
    expect(n!.chatId).toBe("555");
    expect(n!.chatTitle).toBe("Salma");
    expect(n!.chatType).toBe("private");
    expect(n!.fromName).toBe("Salma K");
    expect(n!.fromId).toBe("777");
  });

  it("maps channel posts with no sender as from 'channel'", () => {
    const n = normalizeUpdate({
      update_id: 2,
      channel_post: {
        message_id: 11,
        date: 1700000000,
        text: "/start",
        chat: { id: -100990, title: "Org Channel", username: "orgchan", type: "channel" },
      },
    });
    expect(n!.chatTitle).toBe("Org Channel");
    expect(n!.fromName).toBe("channel");
    expect(n!.fromId).toBeNull();
  });

  it("falls back to captions when text missing, and ignores edits", () => {
    const cap = normalizeUpdate({
      update_id: 3,
      message: {
        message_id: 12,
        date: 1700000000,
        caption: "photo caption",
        chat: { id: 666, title: "Ops", type: "group" },
        from: { id: 1, first_name: "A" },
      },
    });
    expect(cap!.text).toBe("photo caption");
    expect(cap!.chatType).toBe("group");
    expect(normalizeUpdate({ update_id: 4 })).toBeNull();
  });
});

describe("n8n", () => {
  it("exposes a closed event vocabulary", () => {
    const expected = ["task.created", "task.completed", "task.moved", "idea.created", "idea.accepted", "idea.rejected", "comment.created", "member.joined"];
    expect([...N8N_EVENTS]).toEqual(expected);
  });

  it("guards dispatch on known events only", () => {
    expect(isN8nEvent("task.created")).toBe(true);
    expect(isN8nEvent("task.failed_hack")).toBe(false);
    expect(isN8nEvent("")).toBe(false);
  });
});

describe("google oauth state", () => {
  it("signs and verifies org+user bound state", () => {
    const state = signState("org-1", "user-2");
    const parsed = verifyState(state);
    expect(parsed).toEqual({ orgId: "org-1", userId: "user-2" });
  });

  it("rejects tampered ids and malformed states", () => {
    const state = signState("org-1", "user-2");
    expect(verifyState("org-2.user-2." + state.split(".").pop())).toBeNull();
    expect(verifyState("nonsense")).toBeNull();
    // prevent cross-org reuse: a modified payload breaks the signature
    expect(verifyState("attacker.user-2." + state.split(".").pop())).toBeNull();
  });
});
