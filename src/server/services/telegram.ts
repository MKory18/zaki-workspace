import { randomInt } from "node:crypto";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import { decryptSecrets } from "@/server/crypto";
import { log } from "@/server/log";
import { getIntegration, requireConnected, upsertIntegration, logEvent } from "@/server/services/integrations";

const API = "https://api.telegram.org";

interface TelegramApiOk<T> {
  ok: true;
  result: T;
}
interface TelegramApiErr {
  ok: false;
  description: string;
  error_code?: number;
}
type TelegramApi<T> = TelegramApiOk<T> | TelegramApiErr;

interface TgChat {
  id: number;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  type?: string;
}
interface TgFrom {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
}
interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgFrom;
  text?: string;
  date: number;
  caption?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
  edited_message?: TgMessage;
  edited_channel_post?: TgMessage;
}

async function tg<T>(token: string, method: string, params?: Record<string, unknown>): Promise<TelegramApi<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params ?? {}),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as TelegramApi<T> | null;
    if (!json) return { ok: false, description: "telegram.unreachable" };
    return json;
  } catch {
    return { ok: false, description: "telegram.unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validates a bot token by calling getMe. Returns the bot identity when the
 * credentials are real; throws nothing — the caller maps the failure.
 * (Bot-mode only: per-account MTProto client login is explicitly not supported.)
 */
export async function verifyBotToken(token: string): Promise<{ ok: true; botId: number; username: string } | { ok: false; error: string }> {
  const me = await tg<{ id: number; username?: string; is_bot?: boolean }>(token, "getMe");
  if (!me.ok) {
    // Telegram answers 401 "Unauthorized" for bad tokens — translate to an i18n code
    if (me.error_code === 401 || /unauthorized|token/i.test(me.description)) {
      return { ok: false, error: "telegram.invalid_token" };
    }
    return { ok: false, error: me.description || "telegram.unreachable" };
  }
  if (!me.result.is_bot) return { ok: false, error: "telegram.not_bot" };
  return { ok: true, botId: me.result.id, username: me.result.username ?? "bot" };
}

/** Connect: verify first, then store (token encrypted at rest). */
export async function connectBot(orgId: string, token: string): Promise<{ username: string } | { error: string }> {
  const verified = await verifyBotToken(token.trim());
  if (!verified.ok) return { error: verified.error };
  await upsertIntegration(orgId, "TELEGRAM", {
    connected: true,
    secrets: { botToken: token.trim() },
    config: { botUsername: verified.username },
    lastSyncAt: new Date(),
  });
  await logEvent(orgId, { direction: "IN", type: "telegram.connected", payload: { bot: verified.username } });
  return { username: verified.username };
}

export async function disconnect(orgId: string): Promise<void> {
  await upsertIntegration(orgId, "TELEGRAM", { connected: false, secrets: null });
  await logEvent(orgId, { direction: "IN", type: "telegram.disconnected" });
}

interface NormalizedMessage {
  chatId: string;
  chatTitle: string;
  chatType: string;
  messageId: number;
  fromName: string;
  fromId: string | null;
  text: string | null;
  sentAt: Date;
}

/** Pure mapping of a Telegram update to our storage shape (unit-tested). */
export function normalizeUpdate(u: TgUpdate): NormalizedMessage | null {
  const msg = u.message ?? u.channel_post ?? null;
  if (!msg) return null; // edits & non-message updates are ignored (no dupes)
  const chat = msg.chat;
  const personTitle = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
  const title = chat.title || personTitle || chat.username || String(chat.id);
  const from = msg.from;
  const senderTitle = from ? [from.first_name, from.last_name].filter(Boolean).join(" ").trim() : "";
  const fromName = from ? senderTitle || `id:${from.id}` : "channel";
  return {
    chatId: String(chat.id),
    chatTitle: title,
    chatType: chat.type ?? "private",
    messageId: msg.message_id,
    fromName,
    fromId: from ? String(from.id) : null,
    text: msg.text ?? msg.caption ?? null,
    sentAt: new Date(msg.date * 1000),
  };
}

/** Pulls new updates (getUpdates with the stored offset) and stores messages. */
export async function syncUpdates(orgId: string): Promise<{ ok: true; stored: number } | { ok: false; error: string }> {
  const conn = await getIntegration(orgId, "TELEGRAM");
  if (!conn?.connected) return { ok: false, error: "integration.not_connected" };
  const secrets = decryptSecrets<{ botToken: string }>(conn.secretEnc);
  if (!secrets?.botToken) return { ok: false, error: "integration.bad_secret" };

  const meta = (conn.config ?? {}) as { lastUpdateId?: number; botUsername?: string };
  const updates = await tg<TgUpdate[]>(secrets.botToken, "getUpdates", {
    offset: meta.lastUpdateId ?? 0,
    timeout: 0, // short poll so a page refresh stays snappy
    limit: 100,
    allowed_updates: JSON.stringify(["message", "channel_post"]),
  });
  if (!updates.ok) return { ok: false, error: updates.description };

  const rows: NormalizedMessage[] = [];
  let maxId = meta.lastUpdateId ?? 0;
  for (const u of updates.result) {
    maxId = Math.max(maxId, u.update_id + 1);
    const norm = normalizeUpdate(u);
    if (norm) rows.push(norm);
  }

  for (const m of rows) {
    await db.telegramChat.upsert({
      where: { integrationId_chatId: { integrationId: conn.id, chatId: m.chatId } },
      create: { orgId, integrationId: conn.id, chatId: m.chatId, title: m.chatTitle, type: m.chatType },
      update: { title: m.chatTitle },
    });
    await db.telegramMessage.upsert({
      where: {
        integrationId_chatId_messageId: { integrationId: conn.id, chatId: m.chatId, messageId: m.messageId },
      },
      create: {
        orgId,
        integrationId: conn.id,
        chatId: m.chatId,
        messageId: m.messageId,
        fromName: m.fromName,
        fromId: m.fromId,
        text: m.text,
        isCommand: (m.text ?? "").startsWith("/"),
        sentAt: m.sentAt,
      },
      update: {},
    });
  }

  await db.integration.update({
    where: { orgId_type: { orgId, type: "TELEGRAM" } },
    data: { lastSyncAt: new Date(), config: { ...meta, lastUpdateId: maxId } },
  });
  return { ok: true, stored: rows.length };
}

export async function listChats(orgId: string) {
  const integration = await db.integration.findUnique({
    where: { orgId_type: { orgId, type: "TELEGRAM" } },
    select: { id: true, connected: true, config: true, lastSyncAt: true },
  });
  if (!integration?.connected) return null;
  const chats = await db.telegramChat.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, chatId: true, title: true, type: true, createdAt: true },
  });
  return { chats, config: integration.config, lastSyncAt: integration.lastSyncAt };
}

export async function chatMessages(orgId: string, chatId: string, limit = 80) {
  const integration = await db.integration.findUnique({
    where: { orgId_type: { orgId, type: "TELEGRAM" } },
    select: { id: true },
  });
  if (!integration) throw new NotFoundError("integration.not_connected");
  return db.telegramMessage.findMany({
    where: { orgId, integrationId: integration.id, chatId },
    orderBy: { sentAt: "desc" },
    take: limit,
    select: { id: true, messageId: true, fromName: true, fromId: true, text: true, isCommand: true, sentAt: true },
  });
}

/** Sends a message from the connected bot; ADMIN/MEMBER only, audited. */
export async function sendMessage(orgId: string, chatId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { secrets } = await requireConnected(orgId, "TELEGRAM");
  const botToken = secrets.botToken;
  if (!botToken) return { ok: false, error: "integration.bad_secret" };
  const res = await tg<TgMessage>(botToken, "sendMessage", { chat_id: chatId, text });
  if (!res.ok) return { ok: false, error: res.description };

  // Telegram has delivered the message. Nothing below may turn that into a failure:
  // the stored copy is a convenience (it keeps the conversation one thread), not the send.
  try {
    await storeOutgoingCopy(orgId, chatId, text, res.result?.message_id);
  } catch (err) {
    log.warn("telegram.outgoing_copy_failed", { orgId, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
  }
  await logEvent(orgId, { direction: "OUT", type: "telegram.message_sent", payload: { chatId } });
  return { ok: true };
}

const INT32_MAX = 2_147_483_647;

/** A message_id Telegram can really have assigned: a positive 32-bit integer. */
function isTelegramMessageId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= INT32_MAX;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/**
 * Stores the bot's own message in the thread under Telegram's real message_id (unique per
 * chat). It used to be -unixSeconds, so two sends in one second collided on the unique key
 * and the second request failed although Telegram had already delivered it.
 *
 * - With the real id the write is an upsert that leaves an existing row alone: a channel
 *   echoes the bot's own post back to the sync, which stores the very same message.
 * - Only when Telegram's answer carries no usable id does the copy get a negative marker,
 *   drawn at random and retried on the (very unlikely) collision.
 */
async function storeOutgoingCopy(orgId: string, chatId: string, text: string, telegramMessageId: unknown): Promise<void> {
  const integration = await db.integration.findUnique({
    where: { orgId_type: { orgId, type: "TELEGRAM" } },
    select: { id: true, config: true },
  });
  if (!integration) return;
  const meta = (integration.config ?? {}) as { botUsername?: string };
  const chat = await db.telegramChat.findUnique({
    where: { integrationId_chatId: { integrationId: integration.id, chatId } },
    select: { id: true },
  });
  if (!chat) return;
  const botName = meta.botUsername ? `@${meta.botUsername}` : "Zaki";
  const copy = { orgId, integrationId: integration.id, chatId, fromName: botName, fromId: null, text, isCommand: false, sentAt: new Date() };

  if (isTelegramMessageId(telegramMessageId)) {
    await db.telegramMessage.upsert({
      where: { integrationId_chatId_messageId: { integrationId: integration.id, chatId, messageId: telegramMessageId } },
      create: { ...copy, messageId: telegramMessageId },
      update: {},
    });
    return;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await db.telegramMessage.create({ data: { ...copy, messageId: -randomInt(1, INT32_MAX) } });
      return;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
}
