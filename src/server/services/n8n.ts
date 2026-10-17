import { z } from "zod";
import { db } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { safeEqual } from "@/server/crypto";
import {
  emitOutbound,
  getIntegration,
  logEvent,
  upsertIntegration,
} from "@/server/services/integrations";

/** Events we allow orgs to forward to n8n — the UI shows exactly this list. */
export const N8N_EVENTS = [
  "task.created",
  "task.completed",
  "task.moved",
  "idea.created",
  "idea.accepted",
  "idea.rejected",
  "comment.created",
  "member.joined",
] as const;

export type N8nEvent = (typeof N8N_EVENTS)[number];

export function isN8nEvent(value: string): value is N8nEvent {
  return (N8N_EVENTS as readonly string[]).includes(value);
}

export interface N8nStatus {
  connected: boolean;
  webhookUrl: string | null;
  events: string[];
  sharedSecret: string | null; // masked client-side (shown copy-once on connect)
}

/** OWNER/ADMIN config save: webhook URL + event filter; generates the secret once. */
export async function configureN8n(
  orgId: string,
  input: { webhookUrl: string; events: string[]; rotateSecret?: boolean },
): Promise<N8nStatus & { generatedSecret?: string }> {
  // keep the existing shared secret when present (unless rotated), otherwise mint one
  const currentSecret = input.rotateSecret ? null : await readSharedSecret(orgId);
  const sharedSecret = currentSecret ?? generateSecret();

  const meta: Prisma.InputJsonValue = {
    webhookUrl: input.webhookUrl,
    events: input.events.filter(isN8nEvent),
  };
  const secretsBlob: Record<string, string> = { sharedSecret };

  await upsertIntegration(orgId, "N8N", {
    connected: Boolean(input.webhookUrl),
    secrets: secretsBlob,
    config: meta,
  });
  await logEvent(orgId, { direction: "IN", type: "n8n.configured", payload: { events: meta.events } });

  const status = await getN8nStatus(orgId);
  return { ...status, generatedSecret: currentSecret ? undefined : sharedSecret };
}

async function readSharedSecret(orgId: string): Promise<string | null> {
  const row = await getIntegration(orgId, "N8N");
  if (!row?.secretEnc) return null;
  // lightweight inline decrypt to avoid circular import: decryptSecrets is cheap
  const { decryptSecrets } = await import("@/server/crypto");
  const parsed = decryptSecrets<{ sharedSecret: string }>(row.secretEnc);
  return parsed?.sharedSecret ?? null;
}

function generateSecret(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 32; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function getN8nStatus(orgId: string): Promise<N8nStatus> {
  const row = await getIntegration(orgId, "N8N");
  if (!row) return { connected: false, webhookUrl: null, events: [], sharedSecret: null };
  const meta = (row.config ?? {}) as { webhookUrl?: string; events?: string[] };
  return {
    connected: row.connected && Boolean(meta.webhookUrl),
    webhookUrl: meta.webhookUrl ?? null,
    events: meta.events ?? [],
    sharedSecret: row.secretEnc ? "__stored__" : null,
  };
}

export async function disconnectN8n(orgId: string): Promise<void> {
  await upsertIntegration(orgId, "N8N", { connected: false, secrets: null });
  await logEvent(orgId, { direction: "OUT", type: "n8n.disconnected" });
}

export async function recentEvents(orgId: string, take = 12) {
  return db.integrationEvent.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, direction: true, type: true, status: true, detail: true, createdAt: true },
  });
}

const inboundSchema = z.object({
  // n8n sends {action}, generic senders may send {event} — both accepted
  action: z.string().min(1).optional(),
  event: z.string().min(1).optional(),
  title: z.string().min(1).max(180).optional(),
  description: z.string().max(4000).optional(),
  workspaceId: z.string().min(3).optional(),
  projectId: z.string().min(3).optional(),
  boardId: z.string().min(3).optional(),
});

export interface InboundResult {
  ok: boolean;
  status: number;
  body: { ok: true; action: string; taskId?: string; ignored?: boolean } | { ok: false; error: string };
}

/**
 * Inbound webhook from n8n (or any script): shared-secret header required.
 * Only `action: "createTask"` is implemented today; unknown actions are
 * acknowledged-but-ignored so workflows never hard-fail.
 */
export async function handleInbound(
  orgId: string,
  providedSecret: string | undefined,
  rawBody: unknown,
): Promise<InboundResult> {
  const secrets = await readSharedSecret(orgId);
  if (!secrets || !providedSecret) {
    return { ok: false, status: 401, body: { ok: false, error: "n8n.unauthorized" } };
  }
  if (!safeEqual(providedSecret.trim(), secrets)) {
    return { ok: false, status: 401, body: { ok: false, error: "n8n.unauthorized" } };
  }

  const parsed = inboundSchema.safeParse(rawBody);
  if (!parsed.success) {
    await logEvent(orgId, {
      direction: "IN",
      type: "n8n.inbound",
      status: "FAILED",
      detail: parsed.error.issues.map((i) => i.path.join(".")).join(",") || "invalid",
    });
    return { ok: false, status: 400, body: { ok: false, error: "n8n.invalid_payload" } };
  }

  const action = parsed.data.action ?? parsed.data.event ?? "";
  if (action !== "createTask") {
    await logEvent(orgId, { direction: "IN", type: `n8n.inbound.${action || "ping"}`, payload: parsed.data as Prisma.InputJsonValue });
    return { ok: true, status: 200, body: { ok: true, action, ignored: true } };
  }

  if (!parsed.data.title || !parsed.data.workspaceId || !parsed.data.projectId || !parsed.data.boardId) {
    await logEvent(orgId, { direction: "IN", type: "n8n.inbound", status: "FAILED", detail: "missing task fields" });
    return { ok: false, status: 400, body: { ok: false, error: "n8n.create_task_requires_fields" } };
  }

  // The webhook has no human actor — the org OWNER acts on its behalf.
  const owner = await db.organizationMember.findFirst({
    where: { organizationId: orgId, role: "OWNER" },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) {
    return { ok: false, status: 503, body: { ok: false, error: "n8n.no_owner" } };
  }

  const { createTask } = await import("@/server/services/tasks");
  try {
    const task = await createTask(
      { userId: owner.userId, orgId },
      {
        workspaceId: parsed.data.workspaceId,
        projectId: parsed.data.projectId,
        boardId: parsed.data.boardId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
      },
    );
    await logEvent(orgId, { direction: "IN", type: "n8n.inbound", payload: { taskId: task.id } });
    return { ok: true, status: 201, body: { ok: true, action: "createTask", taskId: task.id } };
  } catch (err) {
    await logEvent(orgId, {
      direction: "IN",
      type: "n8n.inbound",
      status: "FAILED",
      detail: err instanceof Error ? err.message.slice(0, 200) : "task create failed",
    });
    return { ok: false, status: 400, body: { ok: false, error: "n8n.create_task_failed" } };
  }
}

export async function dispatchEvent(orgId: string, event: N8nEvent, payload: unknown): Promise<void> {
  await emitOutbound(orgId, event, payload);
}

/** Sends a self-describing test payload through the exact production path. */
export async function sendTestPayload(orgId: string): Promise<{ delivered: boolean; detail?: string }> {
  const row = await getIntegration(orgId, "N8N");
  if (!row?.connected) return { delivered: false, detail: "integration.not_connected" };
  await emitOutbound(orgId, "n8n.test", { message: "Zaki Workspace test event" });
  const recent = await db.integrationEvent.findFirst({
    where: { orgId, direction: "OUT", type: "n8n.test" },
    orderBy: { createdAt: "desc" },
    select: { status: true, detail: true },
  });
  return { delivered: recent?.status === "OK", detail: recent?.detail ?? undefined };
}
