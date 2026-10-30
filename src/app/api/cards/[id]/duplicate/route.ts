import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { duplicateCard } from "@/server/services/cards";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ card: await duplicateCard(actor, params.id) }, { status: 201 });
  });
}
