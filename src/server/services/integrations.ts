import { db } from "@/server/db";
import type { Prisma } from "@prisma/client";
import type { IntegrationType } from "@prisma/client";
import { decryptSecrets, encryptSecrets, hmacHex } from "@/server/crypto";
import { requireOrgRole, requireUser, ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";

/** OWNER/ADMIN only for connect/disconnect/config changes (org-level assets). */
export async function assertOrgManager(orgId: string): Promise<OrgAccessContext> {
  return requireOrgRole(orgId, ["OWNER", "ADMIN"]);
}

/**
 * The caller's active org = their oldest membership (same rule as ideas).
 * Shared by every /api/integrations route.
 */
export async function activeOrgCtx(): Promise<OrgAccessContext> {
  const user = await requireUser();
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (!membership) throw new ForbiddenError("not_org_member");
  return { orgId: membership.organizationId, orgRole: membership.role, userId: user.id };
}

export interface IntegrationConfigMeta extends Record<string, unknown> {}

/**
 * Returns the existing integration row for the org or null when never set up.
 * Secrets stay encrypted at rest and are never part of returned objects.
 */
export async function getIntegration(orgId: string, type: IntegrationType) {
  return db.integration.findUnique({
    where: { orgId_type: { orgId, type } },
  });
}

export async function requireConnected(orgId: string, type: IntegrationType) {
  const row = await getIntegration(orgId, type);
  if (!row || !row.connected || !row.secretEnc) {
    throw new NotFoundError("integration.not_connected");
  }
  const secrets = decryptSecrets<Record<string, string>>(row.secretEnc);
  if (!secrets) throw new NotFoundError("integration.bad_secret");
  return { row, secrets };
}

export async function upsertIntegration(
  orgId: string,
  type: IntegrationType,
  data: { connected: boolean; secrets?: Record<string, unknown> | null; config?: Prisma.InputJsonValue; lastSyncAt?: Date },
) {
  const secretEnc = data.secrets ? encryptSecrets(data.secrets) : undefined;
  if (secretEnc === undefined && data.secrets === undefined && !data.connected) {
    // disconnect: drop stored secrets entirely
    await db.integration.deleteMany({ where: { orgId, type } });
    return null;
  }
  return db.integration.upsert({
    where: { orgId_type: { orgId, type } },
    create: {
      orgId,
      type,
      connected: data.connected,
      secretEnc,
      config: data.config,
    },
    update: {
      connected: data.connected,
      ...(secretEnc !== undefined ? { secretEnc } : {}),
      ...(data.config !== undefined ? { config: data.config } : {}),
      ...(data.lastSyncAt !== undefined ? { lastSyncAt: data.lastSyncAt } : {}),
    },
  });
}

/** Logs an integration event; failures are recorded, never hidden, never thrown. */
export async function logEvent(
  orgId: string,
  input: { direction: "OUT" | "IN"; type: string; payload?: Prisma.InputJsonValue; status?: "OK" | "FAILED"; detail?: string },
): Promise<void> {
  try {
    await db.integrationEvent.create({
      data: {
        orgId,
        direction: input.direction,
        type: input.type,
        payload: input.payload,
        status: input.status ?? "OK",
        detail: input.detail,
      },
    });
  } catch {
    // logging must never crash the caller
  }
}

/**
 * Outbound webhook delivery with HMAC signature (X-Zaki-Signature).
 * Fire-and-audit: the caller's business logic never fails because of n8n.
 */
export async function emitOutbound(orgId: string, event: string, payload: unknown): Promise<void> {
  const row = await getIntegration(orgId, "N8N");
  if (!row?.connected || !row.secretEnc) return;
  const meta = (row.config ?? {}) as { webhookUrl?: string; events?: string[] };
  const secrets = decryptSecrets<{ sharedSecret: string }>(row.secretEnc);
  if (!meta.webhookUrl || !secrets?.sharedSecret) return;
  const events = meta.events ?? [];
  if (events.length && !events.includes(event)) return;

  const body = JSON.stringify({ event, orgId, at: new Date().toISOString(), payload });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(meta.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zaki-signature": `sha256=${hmacHex(secrets.sharedSecret, body)}`,
        "x-zaki-event": event,
        // also carries the org + shared token so token-validating receivers
        // (incl. Zaki's own inbound webhook) can route/verify without parsing JSON
        "x-zaki-org": orgId,
        "x-zaki-token": secrets.sharedSecret,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    await logEvent(orgId, {
      direction: "OUT",
      type: event,
      payload: payload as Prisma.InputJsonValue,
      status: res.ok ? "OK" : "FAILED",
      detail: res.ok ? undefined : `HTTP ${res.status}`,
    });
  } catch (err) {
    await logEvent(orgId, {
      direction: "OUT",
      type: event,
      payload: payload as Prisma.InputJsonValue,
      status: "FAILED",
      detail: err instanceof Error ? err.message.slice(0, 200) : "network error",
    });
  }
}
