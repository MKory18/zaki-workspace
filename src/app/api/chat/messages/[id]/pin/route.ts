import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { togglePin } from "@/server/services/chat";

/** POST: pin/unpin — DM participants both; GROUP admins only (service-enforced). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await togglePin(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
