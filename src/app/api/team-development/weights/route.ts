import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { getWeights, setWeights, weightsSchema } from "@/server/services/team-score";

/** The score's weights: GET for every reader of «الأداء والتطوير» (they are printed beside the score); PUT { manual, completed, onTime, steps } the owner's alone. */
export async function GET() {
  return withApi(async () => NextResponse.json({ weights: await getWeights(await requireActor()) }, { headers: { "cache-control": "no-store" } }));
}

export async function PUT(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const weights = await parseJson(weightsSchema, req);
    return NextResponse.json({ weights: await setWeights(actor, weights) });
  });
}
