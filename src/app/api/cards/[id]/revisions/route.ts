import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { listRevisions } from "@/server/services/card-revisions";

/** The snapshots every saved edit left behind, newest first. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await listRevisions(actor, params.id));
  });
}
