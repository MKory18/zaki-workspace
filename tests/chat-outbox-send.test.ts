import { describe, expect, it } from "vitest";
import { classifyFailure, postChatMessage, reasonKey, retryAfterSeconds, SEND_TIMEOUT_MS } from "../src/lib/chat/outbox/send";
import { composeOutboxStorage, memoryOutboxStorage, type OutboxStorage } from "../src/lib/chat/outbox/storage";
import { clearComposerDraft, composerDraftKey, loadComposerDraft, saveComposerDraft } from "../src/lib/chat/composer-draft";
import { AR } from "../src/lib/i18n/dict";

/** What an answer (or no answer) to a send means for the outbox, and where the outbox keeps its text. */

const payload = { body: "مرحبا", attachmentIds: [], mentions: [], clientId: "client-1" };
type Answer = { ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> };
const answer = (status: number, json: unknown = {}, headers: Record<string, string> = {}): Answer => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  json: async () => json,
});

describe("what an answer means", () => {
  it("no answer (offline, a dropped connection) is transient: the message is kept", async () => {
    const out = await postChatMessage("c1", payload, async () => { throw new TypeError("Failed to fetch"); });
    expect(out).toEqual({ kind: "transient" });
  });

  it("an answer cut off after the server accepted it is transient too (the same clientId finds the message next time)", async () => {
    const out = await postChatMessage("c1", payload, async () => ({ ...answer(201), json: async () => { throw new SyntaxError("cut"); } }));
    expect(out).toEqual({ kind: "transient" });
  });

  it("502, 503, 504 (and 408, 409, 401) are transient", () => {
    for (const status of [502, 503, 504, 408, 409, 401]) expect(classifyFailure(status, null), String(status)).toEqual({ kind: "transient" });
  });

  it("403, 404, 422 and an ordinary 500 are definitive, each with its Arabic reason", () => {
    expect(classifyFailure(403, null)).toEqual({ kind: "refused", failure: { status: 403, key: "outbox.reason.forbidden" } });
    expect(classifyFailure(404, null)).toEqual({ kind: "refused", failure: { status: 404, key: "outbox.reason.gone" } });
    expect(classifyFailure(422, null)).toEqual({ kind: "refused", failure: { status: 422, key: "outbox.reason.invalid" } });
    expect(classifyFailure(500, null)).toEqual({ kind: "refused", failure: { status: 500, key: "outbox.reason.other" } });
    for (const key of ["outbox.reason.forbidden", "outbox.reason.gone", "outbox.reason.invalid", "outbox.reason.rate", "outbox.reason.other"]) expect(AR[key], key).toMatch(/[؀-ۿ]/);
  });

  it("the server's own chat.e.* line wins when the dictionary has it; an unknown key falls back to the generic reason", () => {
    expect(reasonKey(403, "chat.e.mute_denied")).toBe("chat.e.mute_denied");
    expect(reasonKey(403, "chat.e.no_such_line_anywhere")).toBe("outbox.reason.forbidden");
    expect(reasonKey(403, "something else")).toBe("outbox.reason.forbidden");
  });

  it("429 carries the seconds to wait (a number, an HTTP date, or 30 when it is missing)", () => {
    expect(classifyFailure(429, "12")).toEqual({ kind: "limited", retryAfterSec: 12 });
    expect(retryAfterSeconds(null)).toBe(30);
    expect(retryAfterSeconds("garbage")).toBe(30);
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(retryAfterSeconds("Thu, 01 Jan 2026 00:00:20 GMT", now)).toBe(20);
  });

  it("a 2xx is the message the server made", async () => {
    const out = await postChatMessage("c1", payload, async () => answer(201, { id: "m1", clientId: "client-1" }));
    expect(out.kind).toBe("sent");
    if (out.kind === "sent") expect(out.message.id).toBe("m1");
  });

  it("a refusal's own words are read from the answer", async () => {
    const out = await postChatMessage("c1", payload, async () => answer(403, { error: "forbidden", message: "chat.e.mute_denied" }));
    expect(out).toEqual({ kind: "refused", failure: { status: 403, key: "chat.e.mute_denied" } });
    const limited = await postChatMessage("c1", payload, async () => answer(429, { error: "rate_limited" }, { "retry-after": "9" }));
    expect(limited).toEqual({ kind: "limited", retryAfterSec: 9 });
  });
});

describe("every attempt is the same request", () => {
  it("posts to the conversation with the SAME clientId each time (the key the server's idempotency rests on)", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = async (url: string, init: { body: string }) => {
      seen.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return answer(503);
    };
    await postChatMessage("c 1", payload, fetchImpl);
    await postChatMessage("c 1", payload, fetchImpl);
    expect(seen.map((s) => s.url)).toEqual(["/api/chat/conversations/c%201/messages", "/api/chat/conversations/c%201/messages"]);
    expect(seen.map((s) => s.body["clientId"])).toEqual(["client-1", "client-1"]);
    expect(seen[0]?.body["body"]).toBe("مرحبا");
  });

  it("a request nobody answers is given up on at the timeout (the queue keeps the message)", async () => {
    let aborted = false;
    const fetchImpl = (_url: string, init: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); });
      });
    const out = await postChatMessage("c1", payload, fetchImpl as never, 5);
    expect(aborted).toBe(true);
    expect(out).toEqual({ kind: "transient" });
    expect(SEND_TIMEOUT_MS).toBeGreaterThan(5_000);
  });
});

describe("the storage: IndexedDB first, localStorage behind it", () => {
  const broken = (): OutboxStorage => ({
    load: async () => { throw new Error("blocked"); },
    save: async () => { throw new Error("blocked"); },
    remove: async () => { throw new Error("blocked"); },
    removeAll: async () => { throw new Error("blocked"); },
  });

  it("writes to the primary and leaves no second copy behind", async () => {
    const primary = memoryOutboxStorage();
    const fallback = memoryOutboxStorage({ k: "old" });
    const store = composeOutboxStorage(primary, fallback);
    await store.save("k", "new");
    expect(primary.dump()["k"]).toBe("new");
    expect(fallback.dump()["k"]).toBeUndefined();
    expect(await store.load("k")).toBe("new");
  });

  it("falls back to localStorage when IndexedDB refuses, and reads it back", async () => {
    const fallback = memoryOutboxStorage();
    const store = composeOutboxStorage(broken(), fallback);
    await store.save("k", "v");
    expect(fallback.dump()["k"]).toBe("v");
    expect(await store.load("k")).toBe("v");
    await store.remove("k");
    expect(await store.load("k")).toBeNull();
  });

  it("a stale primary copy never hides the fallback's newer one", async () => {
    const primary = memoryOutboxStorage({ k: "stale" });
    // the primary can be read but not written to: the new text goes to the fallback and the old copy is taken away
    const readOnly: OutboxStorage = { ...primary, save: async () => { throw new Error("quota"); } };
    const fallback = memoryOutboxStorage();
    const store = composeOutboxStorage(readOnly, fallback);
    await store.save("k", "fresh");
    expect(await store.load("k")).toBe("fresh");
  });

  it("with nothing at all, loading answers null and saving says so only when there is nowhere to write", async () => {
    const none = composeOutboxStorage(null, null);
    expect(await none.load("k")).toBeNull();
    await none.remove("k");
    await none.removeAll("zaki.");
  });

  it("sign-out wipes every key under the prefix and nothing else", async () => {
    const store = memoryOutboxStorage({ "zaki.outbox.v1.u1": "a", "zaki.outbox.v1.u2": "b", other: "c" });
    await composeOutboxStorage(store, null).removeAll("zaki.outbox.v1.");
    expect(store.dump()).toEqual({ other: "c" });
  });
});

describe("the composer's draft", () => {
  const mem = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
  };

  it("keeps what was typed per person per conversation, and clears it on send", () => {
    const s = mem();
    saveComposerDraft("u1", "c1", { body: "نص ما انبعت", mentions: ["u2"] }, s);
    saveComposerDraft("u1", "c2", { body: "ثاني", mentions: [] }, s);
    expect(loadComposerDraft("u1", "c1", s)).toEqual({ body: "نص ما انبعت", mentions: ["u2"] });
    expect(loadComposerDraft("u1", "c2", s)?.body).toBe("ثاني");
    expect(loadComposerDraft("u2", "c1", s)).toBeNull(); // another person on the same browser
    clearComposerDraft("u1", "c1", s);
    expect(loadComposerDraft("u1", "c1", s)).toBeNull();
    expect(loadComposerDraft("u1", "c2", s)?.body).toBe("ثاني");
  });

  it("an emptied box removes the entry; broken storage and broken text are no error", () => {
    const s = mem();
    saveComposerDraft("u1", "c1", { body: "x", mentions: [] }, s);
    saveComposerDraft("u1", "c1", { body: "   ", mentions: [] }, s);
    expect(s.map.size).toBe(0);
    s.map.set(composerDraftKey("u1", "c1"), "{not json");
    expect(loadComposerDraft("u1", "c1", s)).toBeNull();
    const throwing = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(() => saveComposerDraft("u1", "c1", { body: "x", mentions: [] }, throwing)).not.toThrow();
    expect(loadComposerDraft("u1", "c1", throwing)).toBeNull();
    expect(() => clearComposerDraft("u1", "c1", throwing)).not.toThrow();
    expect(loadComposerDraft("u1", "c1", null)).toBeNull();
  });
});
