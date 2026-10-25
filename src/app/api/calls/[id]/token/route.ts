import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { callPass } from "@/server/calls/calls";

/** POST: a two-minute pass into the call's room on the calls server. Only for somebody who may join it. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await callPass(ctx, params.id), { headers: { "cache-control": "no-store" } });
  });
}
