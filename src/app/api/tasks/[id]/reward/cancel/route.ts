import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTaskAccess } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { cancelReward } from "@/server/services/rewards";

/**
 * «ألغِ المكافأة» — THE OWNER ONLY, with a reason (audited). A reward that was already awarded is not called off here.
 *
 *  POST { reason }
 */
const schema = z.object({ reason: z.string().max(2000) });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { reason } = await parseJson(schema, req);
    const ctx = await requireTaskAccess(params.id, ["ADMIN", "MEMBER"]);
    return NextResponse.json(await cancelReward(ctx, params.id, reason));
  });
}
