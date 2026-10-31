import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { advanceReview, reviewStatusSchema } from "@/server/services/team-reviews";

/** PATCH { status: "SUBMITTED" | "SHARED" }: the next step of a review (DRAFT → SUBMITTED → SHARED), by its author or the owner. There is no DELETE. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const { status } = await parseJson(reviewStatusSchema, req);
    return NextResponse.json({ review: await advanceReview(actor, params.id, status) });
  });
}
