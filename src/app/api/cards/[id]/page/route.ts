import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { readCardPage } from "@/server/services/card-page";

/** The page inside a card as one read (the card, what the viewer may do, the stars, the gallery). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await readCardPage(actor, params.id));
  });
}
