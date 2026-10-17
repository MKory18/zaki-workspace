import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Secrets-at-rest: AES-256-GCM over a JSON payload.
 * Key is derived from AUTH_SECRET (already required at boot) with a fixed
 * application-scope label, so rotating AUTH_SECRET invalidates old blobs.
 * Plaintext secrets never appear in logs — callers only persist `secretEnc`.
 */

function key(): Buffer {
  return createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}:zaki:secrets:v1`).digest();
}

export function encryptSecrets(plain: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(plain), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${data.toString("base64url")}.${tag.toString("base64url")}`;
}

/** Returns null when the blob is malformed/tampered — callers decide fallback. */
export function decryptSecrets<T>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  const parts = blob.split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0]!, "base64url");
    const data = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** HMAC-SHA256 hex signature for webhook payloads (n8n outbound). */
export function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Constant-time string comparison (signature checks, secrets). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
