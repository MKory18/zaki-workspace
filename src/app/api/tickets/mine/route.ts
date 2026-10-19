import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { myTickets } from "@/server/services/tickets";

/** GET: "تذاكري" — tickets assigned to or created by the caller in their org. */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const tickets = await myTickets(ctx);
    return NextResponse.json({ tickets });
  });
}