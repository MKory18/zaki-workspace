import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTaskAccess } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { awardReward } from "@/server/services/rewards";

/**
 * «اعتمد المكافأة لـ…» — THE OWNER ONLY, once, for one of the task's assignees, after the task is finished. The app records
 * and approves; it never moves money (the payroll pays).
 *
 *  POST { userId }
 */
const schema = z.object({ userId: z.string().min(1) });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { userId } = await parseJson(schema, req);
    const ctx = await requireTaskAccess(params.id, ["ADMIN", "MEMBER"]);
    return NextResponse.json(await awardReward(ctx, params.id, userId));
  });
}
