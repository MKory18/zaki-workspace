import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { openRewardTotals } from "@/server/services/rewards";

/**
 * «مجموع المكافآت المفتوحة»: the OPEN rewards of the company, added in SQL from integer minor units, one row per currency
 * (never mixed). The owner only: anybody else gets an empty list.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const workspaceId = new URL(req.url).searchParams.get("workspaceId");
    return NextResponse.json({ totals: await openRewardTotals(actor, { workspaceId: workspaceId || null }) });
  });
}
