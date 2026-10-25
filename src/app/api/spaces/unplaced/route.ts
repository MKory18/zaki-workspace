import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { listUnplaced } from "@/server/services/move-to-space";

/** GET: the company's things that have no space yet (the OWNER and the ADMINs; anybody else 403). */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ rows: await listUnplaced(actor) });
  });
}
