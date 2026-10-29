import { NextResponse } from "next/server";
import { BodyTooLargeError, readTextLimited } from "@/server/http/body-limit";
import { handleInbound } from "@/server/services/n8n";

/**
 * The body is read with a ceiling: this route answers without a session, so the signature can only
 * be checked AFTER the body is in memory. 1 MB is far above a createTask request and small enough
 * that no caller can make the container hold more (security review D2).
 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Public inbound webhook for n8n (no session cookie). The organisation is named by
 *   x-zaki-org: <organization id>
 * and the caller proves it holds the org's shared secret in one of two ways:
 *   signed (preferred)  x-zaki-timestamp: <unix seconds or ms>
 *                       x-zaki-signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *                       (a timestamp more than 5 minutes off our clock is refused)
 *   legacy              x-zaki-token: <the shared secret shown in Automation settings>
 * Body: { action: "createTask", title, workspaceId, projectId, boardId, description? }
 * Unknown actions are acknowledged-but-ignored so workflows never hard-fail.
 *
 * The body is read as raw text: the signature covers its exact bytes.
 *
 * Known limits, kept on purpose and written down so nobody has to rediscover them:
 *  - The legacy x-zaki-token path stays until every workflow signs its requests
 *    (target: remove it in Phase 7).
 *  - A signed request is not de-duplicated by X-Zaki-Delivery inside the 5-minute window:
 *    replaying the very same request within those five minutes creates the task twice.
 *    Closing that needs a stored delivery id, which is a schema change.
 */
export async function POST(req: Request) {
  try {
    const orgId = req.headers.get("x-zaki-org") ?? "";
    if (!orgId) {
      return NextResponse.json({ ok: false, error: "n8n.org_header_required" }, { status: 400 });
    }
    let raw = "";
    try {
      raw = await readTextLimited(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return NextResponse.json({ ok: false, error: "n8n.body_too_large" }, { status: 413 });
      }
      raw = "";
    }
    const result = await handleInbound(
      orgId,
      {
        token: req.headers.get("x-zaki-token"),
        timestamp: req.headers.get("x-zaki-timestamp"),
        signature: req.headers.get("x-zaki-signature"),
      },
      raw,
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
