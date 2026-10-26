import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { orderSchema, reorderSpaces } from "@/server/services/space-manage";

/** PUT { ids }: the order of the spaces, as dragged on «كل المساحات» (the OWNER and the ADMINs). */
export async function PUT(req: Request) {
  return withApi(async () => {
    const { ids } = await parseJson(orderSchema, req);
    await reorderSpaces(await requireActor(), ids);
    return NextResponse.json({ ok: true });
  });
}
