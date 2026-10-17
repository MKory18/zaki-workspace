import { NextResponse } from "next/server";
import { handleInbound } from "@/server/services/n8n";

/**
 * Public inbound webhook for n8n (no session cookie):
 *   x-zaki-org:   <organization id>
 *   x-zaki-token: <shared secret shown in Automation settings>
 * Body: { action: "createTask", title, workspaceId, projectId, boardId, description? }
 * Unknown actions are acknowledged-but-ignored so workflows never hard-fail.
 */
export async function POST(req: Request) {
  try {
    const orgId = req.headers.get("x-zaki-org") ?? "";
    if (!orgId) {
      return NextResponse.json({ ok: false, error: "n8n.org_header_required" }, { status: 400 });
    }
    const secret = req.headers.get("x-zaki-token") ?? undefined;
    let raw: unknown = null;
    try {
      raw = await req.json();
    } catch {
      raw = null;
    }
    const result = await handleInbound(orgId, secret, raw);
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
