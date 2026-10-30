import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { listLog } from "@/server/services/card-log";

/** «السجل»: the read-only timeline of the card. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ entries: await listLog(actor, params.id) });
  });
}
