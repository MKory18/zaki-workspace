import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { callDetail } from "@/server/calls/calls";

/** GET: one call — who started it, who is in it now, what the viewer may do. Whoever may join it. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await callDetail(ctx, params.id));
  });
}
