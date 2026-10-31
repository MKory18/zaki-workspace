import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { listReviews, reviewInputSchema, saveReview } from "@/server/services/team-reviews";

/**
 * Reviews of one person. GET ?period=: the person reads only the reviews SHARED with them (no private note, not even as a key); the
 * owner and the supervisors read every version. PUT: the viewer's own review of the period (creates it, updates it while DRAFT or
 * SUBMITTED, or with `newVersion: true` starts the next version of a SHARED one).
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const period = new URL(req.url).searchParams.get("period") ?? undefined;
    return NextResponse.json({ reviews: await listReviews(await requireActor(), params.id, period) }, { headers: { "cache-control": "no-store" } });
  });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(reviewInputSchema, req);
    return NextResponse.json(await saveReview(actor, params.id, input));
  });
}
