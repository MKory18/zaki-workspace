import { db } from "@/server/db";
import { decryptSecrets, encryptSecrets, hmacHex } from "@/server/crypto";
import { getIntegration, logEvent, upsertIntegration } from "@/server/services/integrations";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export interface GoogleSecrets {
  refreshToken: string;
  accessToken: string | null;
  email?: string;
  [key: string]: unknown;
}

/** Google app credentials come from the deployment env — the app never invents them. */
export function googleEnv(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret: clientSecret };
}

function redirectUri(): string {
  return `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/google/callback`;
}

/** CSRF-safe state: orgId.userId.signature (HMAC over AUTH_SECRET). */
export function signState(orgId: string, userId: string): string {
  return `${orgId}.${userId}.${hmacHex(process.env.AUTH_SECRET ?? "", `${orgId}.${userId}`)}`;
}

export function verifyState(state: string): { orgId: string; userId: string } | null {
  const idx1 = state.indexOf(".");
  const idx2 = state.lastIndexOf(".");
  if (idx1 <= 0 || idx2 <= idx1) return null;
  const orgId = state.slice(0, idx1);
  const userId = state.slice(idx1 + 1, idx2);
  const sig = state.slice(idx2 + 1);
  if (signState(orgId, userId).split(".").pop() !== sig) return null;
  return { orgId, userId };
}

export function buildAuthUrl(orgId: string, userId: string): string {
  const cfg = googleEnv();
  if (!cfg) throw new Error("google.not_configured");
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: signState(orgId, userId),
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

/** Exchanges the consent code for tokens; store result via connectGoogle. */
export async function exchangeCode(code: string): Promise<{ ok: true; access: string; refresh: string | null } | { ok: false; error: string }> {
  const cfg = googleEnv();
  if (!cfg) return { ok: false, error: "google.not_configured" };
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => null)) as TokenResponse | null;
    if (!json?.access_token) return { ok: false, error: json?.error_description ?? json?.error ?? "google.token_failed" };
    return { ok: true, access: json.access_token, refresh: json.refresh_token ?? null };
  } catch {
    return { ok: false, error: "google.unreachable" };
  }
}

export async function connectGoogle(
  orgId: string,
  userId: string,
  tokens: { access: string; refresh: string | null },
): Promise<void> {
  // First connection supplies the refresh token; later consents only refresh access.
  const previous = await getIntegration(orgId, "GOOGLE_DRIVE");
  const prev = decryptSecrets<GoogleSecrets>(previous?.secretEnc);
  const secrets: GoogleSecrets = {
    refreshToken: tokens.refresh ?? prev?.refreshToken ?? "",
    accessToken: tokens.access,
  };
  await upsertIntegration(orgId, "GOOGLE_DRIVE", {
    connected: Boolean(secrets.refreshToken || secrets.accessToken),
    secrets,
    config: { connectedBy: userId },
  });
  await logEvent(orgId, { direction: "IN", type: "google.connected" });
}

export async function disconnectGoogle(orgId: string): Promise<void> {
  await upsertIntegration(orgId, "GOOGLE_DRIVE", { connected: false, secrets: null });
  await logEvent(orgId, { direction: "OUT", type: "google.disconnected" });
}

export async function getGoogleStatus(orgId: string): Promise<{ connected: boolean; configured: boolean }> {
  const row = await getIntegration(orgId, "GOOGLE_DRIVE");
  return { connected: Boolean(row?.connected), configured: Boolean(googleEnv()) };
}

async function accessToken(orgId: string, opts?: { forceRefresh?: boolean }): Promise<string | null> {
  const row = await getIntegration(orgId, "GOOGLE_DRIVE");
  const secrets = decryptSecrets<GoogleSecrets>(row?.secretEnc);
  if (!row?.connected || !secrets) return null;
  const cfg = googleEnv();
  if (!cfg) return null;

  if (secrets.accessToken && !opts?.forceRefresh) return secrets.accessToken;

  if (!secrets.refreshToken) return null;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: secrets.refreshToken,
    grant_type: "refresh_token",
  });
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => null)) as TokenResponse | null;
    if (!json?.access_token) return null;
    // persist the fresh access token so the next call reuses it
    await db.integration.update({
      where: { orgId_type: { orgId, type: "GOOGLE_DRIVE" } },
      data: { secretEnc: encryptSecrets({ ...secrets, accessToken: json.access_token }) },
    });
    return json.access_token;
  } catch {
    return null;
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  link: string | null;
}

interface DriveListResponse {
  files?: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string }>;
}

async function driveFetch(token: string, params: URLSearchParams): Promise<Response> {
  return fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function listJson(orgId: string, params: URLSearchParams): Promise<DriveListResponse | null> {
  let token = await accessToken(orgId);
  if (!token) return null;
  let res = await driveFetch(token, params);
  if (res.status === 401) {
    token = await accessToken(orgId, { forceRefresh: true });
    if (!token) return null;
    res = await driveFetch(token, params);
  }
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as DriveListResponse | null;
}

/** Read-only browse across the connected Drive for the org-known account. */
export async function listDriveFiles(orgId: string, limit = 25): Promise<{ ok: true; files: DriveFile[] } | { ok: false; error: string }> {
  const row = await getIntegration(orgId, "GOOGLE_DRIVE");
  if (!row?.connected) return { ok: false, error: "google.not_connected" };
  const params = new URLSearchParams({
    pageSize: String(limit),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    q: "trashed=false",
    orderBy: "modifiedTime desc",
  });
  try {
    const json = await listJson(orgId, params);
    if (!json) return { ok: false, error: "google.request_failed" };
    return {
      ok: true,
      files: (json.files ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime ?? null,
        link: f.webViewLink ?? null,
      })),
    };
  } catch {
    return { ok: false, error: "google.unreachable" };
  }
}
