import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { revokeFeedToken } from "@/server/services/calendar-feed";

/** «إلغاء»: the person's own calendar link stops working at once (anybody else's is «not found»). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    await revokeFeedToken(actor, params.id);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
