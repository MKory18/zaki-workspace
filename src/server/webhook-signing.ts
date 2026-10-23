import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed webhook deliveries - the ecosystem's one contract (OMS, System 7, Workspace).
 *
 *   X-Zaki-Event      event name
 *   X-Zaki-Delivery   unique id of this delivery (uuid)
 *   X-Zaki-Timestamp  unix time of the send
 *   X-Zaki-Signature  sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *
 * The timestamp is INSIDE the signed string, so a captured request cannot be
 * replayed later with its signature still valid: receivers refuse a timestamp more
 * than five minutes away from their own clock, in either direction.
 *
 * Workspace sends the timestamp in seconds (like System 7); the OMS sends
 * milliseconds. A receiver accepts both - the HMAC is always computed over the
 * timestamp text exactly as it arrived.
 *
 * Mirrors System 7's reference verifier (src/modules/integrations/signing.ts).
 */

export const SIGNATURE_TOLERANCE_SEC = 5 * 60;

/** hex HMAC-SHA256 over "<timestamp>.<rawBody>" (no prefix). */
export function signZakiPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

/** The X-Zaki-Signature header value: `sha256=<hex>`. */
export function zakiSignatureHeader(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${signZakiPayload(secret, timestamp, rawBody)}`;
}

/** Unix SECONDS as text - the form Workspace sends in X-Zaki-Timestamp. */
export function unixSeconds(now: Date = new Date()): string {
  return String(Math.floor(now.getTime() / 1000));
}

/** Reads a timestamp header in seconds or milliseconds (anything from 10^12 up is milliseconds); null if malformed. */
export function parseZakiTimestamp(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{9,14}$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n >= 1e12 ? Math.floor(n / 1000) : n;
}

export type SignatureFailure = "MISSING_HEADERS" | "BAD_TIMESTAMP" | "STALE_TIMESTAMP" | "BAD_SIGNATURE";

export interface VerifyInput {
  /** The receiver's secret; null/empty (unknown sender) fails like a wrong signature. */
  secret: string | null | undefined;
  timestampHeader: string | null | undefined;
  signatureHeader: string | null | undefined;
  /** The body exactly as received - never re-serialised. */
  rawBody: string;
  now?: Date;
  toleranceSec?: number;
}

function hexEqual(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), "utf8");
  const y = Buffer.from(b.toLowerCase(), "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Checks, in order: both headers present, timestamp well formed and within the
 * tolerance, signature well formed, then the HMAC (constant time). Everything before
 * the HMAC is independent of the secret, so the verdict for a stale or malformed
 * request is the same whether or not the sender exists.
 */
export function verifyZakiSignature(input: VerifyInput): { ok: true; timestampSec: number } | { ok: false; reason: SignatureFailure } {
  const ts = input.timestampHeader?.trim();
  const sig = input.signatureHeader?.trim();
  if (!ts || !sig) return { ok: false, reason: "MISSING_HEADERS" };

  const tsSec = parseZakiTimestamp(ts);
  if (tsSec === null) return { ok: false, reason: "BAD_TIMESTAMP" };
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSec - tsSec) > (input.toleranceSec ?? SIGNATURE_TOLERANCE_SEC)) {
    return { ok: false, reason: "STALE_TIMESTAMP" };
  }

  const provided = sig.startsWith("sha256=") ? sig.slice("sha256=".length) : sig;
  if (!/^[0-9a-fA-F]{64}$/.test(provided)) return { ok: false, reason: "BAD_SIGNATURE" };
  if (!input.secret) return { ok: false, reason: "BAD_SIGNATURE" };

  return hexEqual(signZakiPayload(input.secret, ts, input.rawBody), provided)
    ? { ok: true, timestampSec: tsSec }
    : { ok: false, reason: "BAD_SIGNATURE" };
}
