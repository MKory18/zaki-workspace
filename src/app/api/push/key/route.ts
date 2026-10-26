import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { vapidKeys } from "@/server/calls/push";

/** GET: this server's public push key (a browser needs it to subscribe to rings). Signed-in people only. */
export async function GET() {
  return withApi(async () => {
    await activeOrgCtx();
    return NextResponse.json({ publicKey: vapidKeys().publicKey });
  });
}
