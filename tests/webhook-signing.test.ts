import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SIGNATURE_TOLERANCE_SEC,
  parseZakiTimestamp,
  signZakiPayload,
  unixSeconds,
  verifyZakiSignature,
  zakiSignatureHeader,
} from "../src/server/webhook-signing";

/**
 * The ecosystem's signed-delivery contract (OMS <-> System 7 <-> Workspace):
 *   X-Zaki-Timestamp  unix time of the send
 *   X-Zaki-Signature  sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *   older (or newer) than 5 minutes = refused
 *
 * GOLDEN is a verbatim copy of osm/contracts/oms-app-events.v1/signed-delivery.json,
 * a delivery the OMS actually signed, with the signature it must produce (the secret
 * is the contract's own test-only value). It is the one assertion here that cannot
 * be satisfied by agreeing with ourselves.
 */
const GOLDEN = {
  secret: "test-only-oms-app-secret",
  timestamp: "1791712093000",
  body_raw:
    '{"event":"order.shipped","at":"2026-10-11T09:48:12.000Z","data":{"orderId":"8d7c2f4e-1b9a-4c3e-9f6d-2a5b7c8e9f01","orderNumber":"SY-2026-0148","shippingStatus":"SHIPPED","previousStatus":"READY_FOR_PICKUP","total":185000,"currency":"SYP","trackingNumber":"ALB-77812"}}',
  signature_example: "sha256=a247d08e21565cfba9892352002c8d22cf8bf3a2790185101508df467f7633c0",
};

const SECRET = "s3cret-shared-with-the-receiver";
const BODY = JSON.stringify({ event: "task.created", orgId: "org_1", at: "2026-10-22T10:00:00.000Z", payload: { taskId: "t1" } });
const NOW = new Date("2026-10-22T10:00:00.000Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

function signed(tsSec: number, body = BODY, secret = SECRET) {
  const ts = String(tsSec);
  return { timestampHeader: ts, signatureHeader: zakiSignatureHeader(secret, ts, body), rawBody: body, secret, now: NOW };
}

describe("signing", () => {
  it("reproduces the ecosystem's own worked example byte for byte", () => {
    expect(zakiSignatureHeader(GOLDEN.secret, GOLDEN.timestamp, GOLDEN.body_raw)).toBe(GOLDEN.signature_example);
    expect(`sha256=${signZakiPayload(GOLDEN.secret, GOLDEN.timestamp, GOLDEN.body_raw)}`).toBe(GOLDEN.signature_example);
  });

  it("signs '<timestamp>.<raw body>' with HMAC-SHA256 (independent computation)", () => {
    const expected = createHmac("sha256", SECRET).update(`1790000000.${BODY}`).digest("hex");
    expect(signZakiPayload(SECRET, "1790000000", BODY)).toBe(expected);
    expect(zakiSignatureHeader(SECRET, "1790000000", BODY)).toBe(`sha256=${expected}`);
  });

  it("covers the timestamp: the same body signed at another time gives another signature", () => {
    expect(signZakiPayload(SECRET, "1790000000", BODY)).not.toBe(signZakiPayload(SECRET, "1790000001", BODY));
  });

  it("covers the body and the secret", () => {
    expect(signZakiPayload(SECRET, "1790000000", BODY)).not.toBe(signZakiPayload(SECRET, "1790000000", `${BODY} `));
    expect(signZakiPayload(SECRET, "1790000000", BODY)).not.toBe(signZakiPayload("other", "1790000000", BODY));
  });

  it("is NOT the old scheme: a body-only HMAC is a different value", () => {
    const bodyOnly = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(signZakiPayload(SECRET, "1790000000", BODY)).not.toBe(bodyOnly);
  });

  it("unixSeconds is a whole number of SECONDS (10 digits), as text", () => {
    expect(unixSeconds(NOW)).toBe(String(NOW_SEC));
    expect(unixSeconds()).toMatch(/^\d{10}$/);
  });

  it("the tolerance is five minutes", () => {
    expect(SIGNATURE_TOLERANCE_SEC).toBe(300);
  });
});

describe("parseZakiTimestamp", () => {
  it("reads seconds and milliseconds (the receiver accepts both)", () => {
    expect(parseZakiTimestamp("1790000000")).toBe(1790000000);
    expect(parseZakiTimestamp("1790000000123")).toBe(1790000000);
    expect(parseZakiTimestamp(" 1790000000 ")).toBe(1790000000);
  });

  it.each(["", "abc", "12345", "-1790000000", "1.79e9", "1790000000.5", "0x6b0e5a00", "17900000000000000"])("rejects %j", (raw) => {
    expect(parseZakiTimestamp(raw)).toBeNull();
  });
});

describe("verifyZakiSignature", () => {
  it("accepts a fresh delivery signed in seconds", () => {
    expect(verifyZakiSignature(signed(NOW_SEC))).toEqual({ ok: true, timestampSec: NOW_SEC });
  });

  it("accepts the signature with or without the sha256= prefix, in any hex case", () => {
    const base = signed(NOW_SEC);
    const hex = base.signatureHeader.slice("sha256=".length);
    expect(verifyZakiSignature({ ...base, signatureHeader: hex }).ok).toBe(true);
    expect(verifyZakiSignature({ ...base, signatureHeader: `sha256=${hex.toUpperCase()}` }).ok).toBe(true);
  });

  it("accepts milliseconds, the way the OMS signs (the golden example, at its own moment)", () => {
    const verdict = verifyZakiSignature({
      secret: GOLDEN.secret,
      timestampHeader: GOLDEN.timestamp,
      signatureHeader: GOLDEN.signature_example,
      rawBody: GOLDEN.body_raw,
      now: new Date(Number(GOLDEN.timestamp) + 1000),
    });
    expect(verdict).toEqual({ ok: true, timestampSec: 1791712093 });
  });

  it("refuses a delivery older than five minutes, accepts exactly five", () => {
    expect(verifyZakiSignature(signed(NOW_SEC - 300)).ok).toBe(true);
    expect(verifyZakiSignature(signed(NOW_SEC - 301))).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
    expect(verifyZakiSignature(signed(NOW_SEC - 3600))).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });

  it("refuses a delivery dated more than five minutes in the future, accepts exactly five", () => {
    expect(verifyZakiSignature(signed(NOW_SEC + 300)).ok).toBe(true);
    expect(verifyZakiSignature(signed(NOW_SEC + 301))).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });

  it("a captured request replayed later is refused even though its signature is still valid", () => {
    const captured = signed(NOW_SEC);
    expect(verifyZakiSignature(captured).ok).toBe(true);
    const later = new Date(NOW.getTime() + 6 * 60 * 1000);
    expect(verifyZakiSignature({ ...captured, now: later })).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });

  it("refuses when a header is missing", () => {
    const base = signed(NOW_SEC);
    expect(verifyZakiSignature({ ...base, signatureHeader: null })).toEqual({ ok: false, reason: "MISSING_HEADERS" });
    expect(verifyZakiSignature({ ...base, signatureHeader: "" })).toEqual({ ok: false, reason: "MISSING_HEADERS" });
    expect(verifyZakiSignature({ ...base, timestampHeader: undefined })).toEqual({ ok: false, reason: "MISSING_HEADERS" });
    expect(verifyZakiSignature({ ...base, timestampHeader: " " })).toEqual({ ok: false, reason: "MISSING_HEADERS" });
  });

  it("refuses a timestamp that is not a plain number", () => {
    const base = signed(NOW_SEC);
    for (const bad of ["yesterday", "12345", "1.79e9", "-5"]) {
      expect(verifyZakiSignature({ ...base, timestampHeader: bad })).toEqual({ ok: false, reason: "BAD_TIMESTAMP" });
    }
  });

  it("refuses a wrong secret, a changed body and a re-dated timestamp", () => {
    const base = signed(NOW_SEC);
    expect(verifyZakiSignature({ ...base, secret: "another-secret" })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyZakiSignature({ ...base, rawBody: `${BODY} ` })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    // re-dating a captured request to look fresh invalidates the signature
    expect(verifyZakiSignature({ ...base, timestampHeader: String(NOW_SEC + 1) })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("refuses the old body-only signature (the replayable scheme)", () => {
    const base = signed(NOW_SEC);
    const bodyOnly = `sha256=${createHmac("sha256", SECRET).update(BODY).digest("hex")}`;
    expect(verifyZakiSignature({ ...base, signatureHeader: bodyOnly })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("refuses malformed signatures: not hex, truncated, wrong prefix, empty digest", () => {
    const base = signed(NOW_SEC);
    const hex = base.signatureHeader.slice("sha256=".length);
    for (const bad of ["sha256=zzzz", `sha256=${hex.slice(0, 62)}`, `sha256=${hex}00`, `sha1=${hex}`, "sha256=", `md5:${hex}`]) {
      expect(verifyZakiSignature({ ...base, signatureHeader: bad })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    }
  });

  it("an unknown receiver secret is indistinguishable from a wrong signature", () => {
    const base = signed(NOW_SEC);
    expect(verifyZakiSignature({ ...base, secret: null })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyZakiSignature({ ...base, secret: "" })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyZakiSignature({ ...base, secret: undefined })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("checks the clock before the secret, so staleness says nothing about whether an organisation exists", () => {
    const stale = signed(NOW_SEC - 3600);
    expect(verifyZakiSignature({ ...stale, secret: null })).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
    expect(verifyZakiSignature(stale)).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });

  it("verifies against the timestamp text exactly as it arrived (a ms header must not be re-formatted)", () => {
    const ms = String(NOW_SEC * 1000);
    const sig = zakiSignatureHeader(SECRET, ms, BODY);
    expect(verifyZakiSignature({ secret: SECRET, timestampHeader: ms, signatureHeader: sig, rawBody: BODY, now: NOW }).ok).toBe(true);
    expect(verifyZakiSignature({ secret: SECRET, timestampHeader: String(NOW_SEC), signatureHeader: sig, rawBody: BODY, now: NOW })).toEqual({
      ok: false,
      reason: "BAD_SIGNATURE",
    });
  });
});
