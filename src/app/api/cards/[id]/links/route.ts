import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { listLinks } from "@/server/services/card-links";

/** The tasks made from the card and the topic it was sent to (only what the viewer may open). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await listLinks(actor, params.id));
  });
}
