import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { rateCard, ratingSchema, readRating } from "@/server/services/card-ratings";

type Ctx = { params: { id: string } };

/** The average, the number of raters, my own stars; who rated what only for the owner and the card's creator. */
export async function GET(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ rating: await readRating(actor, params.id) });
  });
}

/** Give or change my stars (1 to 5). */
export async function PUT(req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(ratingSchema, req);
    return NextResponse.json({ rating: await rateCard(actor, params.id, input.stars) });
  });
}
