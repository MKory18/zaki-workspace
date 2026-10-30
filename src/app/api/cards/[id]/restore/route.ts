import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { restoreCard } from "@/server/services/cards";

/** The OWNER brings an archived card back. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ card: await restoreCard(actor, params.id) });
  });
}
