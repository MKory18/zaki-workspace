import { NextResponse } from "next/server";
import { handleInbound } from "@/server/services/n8n";

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
 */
export async function POST(req: Request) {
  try {
    const orgId = req.headers.get("x-zaki-org") ?? "";
    if (!orgId) {
      return NextResponse.json({ ok: false, error: "n8n.org_header_required" }, { status: 400 });
    }
    let raw = "";
    try {
      raw = await req.text();
    } catch {
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
