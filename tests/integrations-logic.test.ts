import { describe, expect, it } from "vitest";
import { decryptSecrets, encryptSecrets, hmacHex, safeEqual } from "../src/server/crypto";
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
