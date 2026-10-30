import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { setExcused } from "@/server/services/checkins";
import { resolveSpaceId } from "@/server/services/checkins-space";

/** «إجازة اليوم» — `{ workspaceId?, on?: boolean (default true), day? }`: marks me excused for today's open round, or takes the mark back. */
const schema = z.object({
  workspaceId: z.string().min(1).max(64).optional(),
  day: z.string().max(10).nullable().optional(),
  on: z.boolean().optional(),
});

export async function POST(req: Request) {
  return withApi(async () => {
    const { workspaceId, on, day } = await parseJson(schema, req);
    return NextResponse.json(await setExcused(await resolveSpaceId(workspaceId), on !== false, { day }));
  });
}
