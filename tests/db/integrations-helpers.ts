import { createHmac } from "node:crypto";
import { vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { encryptSecrets } from "@/server/crypto";
import { db } from "./helpers";

/**
 * Fixtures for the INTEGRATIONS batch (n8n, Telegram, secrets).
 * Rows are written with `db.*` directly, so a test can put any stored state in place
 * (including ones the routes would now refuse) without going through the code under test.
 */

export const HOOK_URL = "https://hooks.example.com/webhook/zaki";
export const PUBLIC_IP = "93.184.216.34";

// ---------- DNS: nothing here may touch the network ----------

export interface DnsMock {
  lookup: ReturnType<typeof vi.fn>;
}

/** What `lookup(host, {all:true})` answers when a test does not say otherwise: one public address. */
export function resolveEverythingPublic(dns: DnsMock): void {
  dns.lookup.mockReset();
  dns.lookup.mockImplementation(async () => [{ address: PUBLIC_IP, family: 4 }]);
}

/** Per-host answers; a host that is not listed resolves to a public address. A value of "ENOTFOUND" rejects. */
export function resolveHosts(dns: DnsMock, table: Record<string, string[] | "ENOTFOUND">): void {
  dns.lookup.mockReset();
  dns.lookup.mockImplementation(async (host: string) => {
    const answer = table[host];
    if (answer === "ENOTFOUND") throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return (answer ?? [PUBLIC_IP]).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  });
}

// ---------- fetch ----------

export interface FetchCall {
  url: string;
  init: RequestInit;
  /** Header names lower-cased, whatever shape the caller passed them in. */
  headers: Record<string, string>;
  body: string;
}

function lowerHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers((h ?? {}) as HeadersInit).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** Replaces global fetch for the test; records every call. Default answer: 200, empty body. */
export function stubFetch(responder?: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(input),
      init: init ?? {},
      headers: lowerHeaders(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    return responder ? responder(call) : new Response(null, { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

// ---------- integration rows ----------

export const N8N_SECRET = "n8n-test-shared-secret-0123456789abcdef0123456789abcdef";

export async function connectN8nDirect(
  orgId: string,
  opts: { url?: string; secret?: string; events?: string[]; connected?: boolean } = {},
) {
  const data = {
    connected: opts.connected ?? true,
    config: { webhookUrl: opts.url ?? HOOK_URL, events: opts.events ?? [] } as Prisma.InputJsonValue,
    secretEnc: encryptSecrets({ sharedSecret: opts.secret ?? N8N_SECRET }),
  };
  return db.integration.upsert({
    where: { orgId_type: { orgId, type: "N8N" } },
    create: { orgId, type: "N8N", ...data },
    update: data,
  });
}

export const n8nRow = (orgId: string) => db.integration.findUnique({ where: { orgId_type: { orgId, type: "N8N" } } });
export const telegramRow = (orgId: string) => db.integration.findUnique({ where: { orgId_type: { orgId, type: "TELEGRAM" } } });

export const BOT_TOKEN = "123456789:AAfake_bot_token_for_the_tests_0123456789abc";

export async function connectTelegramDirect(orgId: string, opts: { chatId?: string } = {}) {
  const row = await db.integration.upsert({
    where: { orgId_type: { orgId, type: "TELEGRAM" } },
    create: {
      orgId,
      type: "TELEGRAM",
      connected: true,
      secretEnc: encryptSecrets({ botToken: BOT_TOKEN }),
      config: { botUsername: "zaki_test_bot" },
    },
    update: { connected: true, secretEnc: encryptSecrets({ botToken: BOT_TOKEN }), config: { botUsername: "zaki_test_bot" } },
  });
  const chatId = opts.chatId ?? "555001";
  await db.telegramChat.upsert({
    where: { integrationId_chatId: { integrationId: row.id, chatId } },
    create: { orgId, integrationId: row.id, chatId, title: "Ops group", type: "group" },
    update: {},
  });
  return { integration: row, chatId };
}

// ---------- raw HTTP into a route handler ----------

/** POSTs an exact body string (what a signature covers) to a route handler. */
export async function postRaw(handler: unknown, url: string, rawBody: string, headers: Record<string, string> = {}) {
  const req = new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: rawBody });
  const res = await (handler as (req: Request) => Promise<Response>)(req);
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

// ---------- signing (independent of the code under test) ----------

/** The ecosystem rule, computed here with node:crypto only: sha256=HMAC(secret, "<ts>.<raw body>"). */
export function signBody(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
