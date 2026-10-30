import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parse } from "@/server/validation";
import { getToday } from "@/server/services/checkins";
import { resolveSpaceId } from "@/server/services/checkins-space";

/**
 * «التسجيل اليومي» — today's round of a space: my answer, who answered and who did not, and (to the owner and the space's
 * ADMIN always, to anybody else only after submitting their own) the teammates' answers. Reading writes nothing.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const { searchParams } = new URL(req.url);
    const q = parse(z.object({ workspaceId: z.string().min(1).max(64).optional() }), { workspaceId: searchParams.get("workspaceId") || undefined });
    return NextResponse.json(await getToday(await resolveSpaceId(q.workspaceId)), { headers: { "Cache-Control": "no-store" } });
  });
}
