import { z } from "zod";
import { db } from "@/server/db";
import { ValidationError } from "@/server/auth";
import { decryptSecrets, encryptSecrets } from "@/server/crypto";
import { dayKeyOf } from "@/lib/owner-board";
import { orgTimeZone } from "@/server/services/org-day";
import { DEFAULT_MODEL, KNOWN_MODELS, isValidModelId } from "@/server/ai/provider";
import { AssistantError } from "@/server/ai/api";

/**
 * «مساعد المالك» — THE SETTINGS, THE KEY AND THE COUNTERS.
 *
 * THE KEY IS WRITE-ONLY. It is encrypted at rest with `ENCRYPTION_KEY` (the same way the Telegram, n8n and Google secrets are,
 * src/server/crypto.ts) in `AiSettings.keyCipher`. Nothing in this file, and nothing that calls it, ever returns it:
 *   - every public read selects explicit columns and NEVER `keyCipher`;
 *   - the screen is shown `hasKey` and the last four characters, computed at the moment the key was saved and stored apart;
 *   - `readKey` is the only reader of the cipher; it is used by the chat service to hand the key to the provider and by nothing else;
 *   - the key never reaches a log line, an audit row, an error message or a response.
 */

export const DEFAULT_DAILY_LIMIT = 50;
export const DEFAULT_MONTHLY_TOKEN_BUDGET = 2_000_000;
export const MAX_DAILY_LIMIT = 10_000;
export const MAX_MONTHLY_BUDGET = 100_000_000;

export interface PublicSettings {
  hasKey: boolean;
  /** The last four characters of the saved key (null: no key). */
  keyLast4: string | null;
  model: string;
  dailyLimit: number;
  monthlyTokenBudget: number;
  allowNames: boolean;
  allowTitles: boolean;
}

export const DEFAULT_SETTINGS: PublicSettings = {
  hasKey: false,
  keyLast4: null,
  model: DEFAULT_MODEL,
  dailyLimit: DEFAULT_DAILY_LIMIT,
  monthlyTokenBudget: DEFAULT_MONTHLY_TOKEN_BUDGET,
  allowNames: false,
  allowTitles: false,
};

/** The columns a read may take: NOT the cipher. */
const PUBLIC_COLUMNS = { keyLast4: true, model: true, dailyLimit: true, monthlyTokenBudget: true, allowNames: true, allowTitles: true } as const;

export async function getSettings(orgId: string): Promise<PublicSettings> {
  const row = await db.aiSettings.findUnique({ where: { orgId }, select: PUBLIC_COLUMNS });
  if (!row) return { ...DEFAULT_SETTINGS };
  return { hasKey: row.keyLast4 !== null, keyLast4: row.keyLast4, model: row.model, dailyLimit: row.dailyLimit, monthlyTokenBudget: row.monthlyTokenBudget, allowNames: row.allowNames, allowTitles: row.allowTitles };
}

/** The key as plain text, for the provider call ONLY. Null: no key saved, or it can no longer be read (the owner enters it again). */
export async function readKey(orgId: string): Promise<string | null> {
  const row = await db.aiSettings.findUnique({ where: { orgId }, select: { keyCipher: true } });
  if (!row?.keyCipher) return null;
  const plain = decryptSecrets<{ apiKey?: unknown }>(row.keyCipher);
  return typeof plain?.apiKey === "string" && plain.apiKey.length > 0 ? plain.apiKey : null;
}

// ───────────────────────────────────────── writing ─────────────────────────────────────────

const settingsSchema = z
  .object({
    model: z.string().trim().refine(isValidModelId, "assistant.model_invalid").optional(),
    dailyLimit: z.number().int().min(1, "assistant.limit_invalid").max(MAX_DAILY_LIMIT, "assistant.limit_invalid").optional(),
    monthlyTokenBudget: z.number().int().min(0, "assistant.budget_invalid").max(MAX_MONTHLY_BUDGET, "assistant.budget_invalid").optional(),
    allowNames: z.boolean().optional(),
    allowTitles: z.boolean().optional(),
  })
  .strict();

export type SettingsPatch = z.infer<typeof settingsSchema>;

function invalid(path: string, message: string): never {
  throw new ValidationError([{ path, message }]);
}

/** The settings screen's save (never the key). Only the fields sent change; the audit row names the fields, not their values. */
export async function updateSettings(ctx: { orgId: string; userId: string }, body: unknown): Promise<PublicSettings> {
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    invalid(first?.path.join(".") || "body", first && first.message.startsWith("assistant.") ? first.message : "validation.failed");
  }
  const patch = parsed.data as SettingsPatch;
  const fields = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  if (fields.length === 0) invalid("body", "validation.failed");
  await db.$transaction(async (tx) => {
    await tx.aiSettings.upsert({ where: { orgId: ctx.orgId }, create: { orgId: ctx.orgId, ...patch }, update: patch });
    await tx.auditLog.create({ data: { action: "ai.settings_changed", actorId: ctx.userId, orgId: ctx.orgId, meta: { fields } } });
  });
  return getSettings(ctx.orgId);
}

/** A key is one header-safe token: printable ASCII with no space, 20 to 400 characters. */
export function validKey(key: unknown): key is string {
  return typeof key === "string" && /^[\x21-\x7E]{20,400}$/.test(key);
}

/** Saves (or replaces) the owner's key: encrypted, with its last four characters stored apart. Returns only what the screen may show. */
export async function saveKey(ctx: { orgId: string; userId: string }, key: unknown): Promise<PublicSettings> {
  const plain = typeof key === "string" ? key.trim() : key;
  if (!validKey(plain)) invalid("key", "assistant.key_invalid");
  const keyCipher = encryptSecrets({ apiKey: plain as string });
  const keyLast4 = (plain as string).slice(-4);
  await db.$transaction(async (tx) => {
    await tx.aiSettings.upsert({ where: { orgId: ctx.orgId }, create: { orgId: ctx.orgId, keyCipher, keyLast4 }, update: { keyCipher, keyLast4 } });
    await tx.auditLog.create({ data: { action: "ai.key_saved", actorId: ctx.userId, orgId: ctx.orgId } });
  });
  return getSettings(ctx.orgId);
}

/** «احذف المفتاح»: the cipher and the last four are erased. Everything else stays. */
export async function removeKey(ctx: { orgId: string; userId: string }): Promise<PublicSettings> {
  await db.$transaction(async (tx) => {
    await tx.aiSettings.updateMany({ where: { orgId: ctx.orgId }, data: { keyCipher: null, keyLast4: null } });
    await tx.auditLog.create({ data: { action: "ai.key_removed", actorId: ctx.userId, orgId: ctx.orgId } });
  });
  return getSettings(ctx.orgId);
}

// ───────────────────────────────────────── the counters ─────────────────────────────────────────

export interface UsageSummary {
  /** The company's day (YYYY-MM-DD). */
  day: string;
  requestsToday: number;
  dailyLimit: number;
  tokensThisMonth: number;
  monthlyTokenBudget: number;
}

/** The sums, in SQL: today's requests and this month's tokens of the whole company. */
export async function usageSummary(orgId: string, settings: PublicSettings, now: Date = new Date()): Promise<UsageSummary> {
  const day = dayKeyOf(now, await orgTimeZone(orgId));
  const [today, month] = await Promise.all([
    db.aiUsage.aggregate({ where: { orgId, day }, _sum: { requests: true } }),
    db.aiUsage.aggregate({ where: { orgId, day: { startsWith: day.slice(0, 7) } }, _sum: { inputTokens: true, outputTokens: true } }),
  ]);
  return {
    day,
    requestsToday: today._sum.requests ?? 0,
    dailyLimit: settings.dailyLimit,
    tokensThisMonth: (month._sum.inputTokens ?? 0) + (month._sum.outputTokens ?? 0),
    monthlyTokenBudget: settings.monthlyTokenBudget,
  };
}

/** Refuses a call that would go over the daily message limit or the monthly token budget. The refusals are Arabic sentences. */
export function assertWithinQuota(usage: UsageSummary): void {
  if (usage.requestsToday >= usage.dailyLimit) throw new AssistantError("assistant.daily_limit", "rate_limited");
  if (usage.tokensThisMonth >= usage.monthlyTokenBudget) throw new AssistantError("assistant.monthly_budget", "rate_limited");
}

/** Counts one answered call (counters only: no content). */
export async function recordUsage(ctx: { orgId: string; userId: string }, day: string, tokens: { inputTokens: number; outputTokens: number }): Promise<void> {
  await db.aiUsage.upsert({
    where: { orgId_userId_day: { orgId: ctx.orgId, userId: ctx.userId, day } },
    create: { orgId: ctx.orgId, userId: ctx.userId, day, inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens, requests: 1 },
    update: { inputTokens: { increment: tokens.inputTokens }, outputTokens: { increment: tokens.outputTokens }, requests: { increment: 1 } },
  });
}

export const MODEL_CHOICES: readonly string[] = KNOWN_MODELS;
