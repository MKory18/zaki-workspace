import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parse } from "@/server/validation";
import { history } from "@/server/services/checkins";
import { resolveSpaceId } from "@/server/services/checkins-space";

/**
 * «التسجيل اليومي» — the past rounds of a space, newest first. `?from=&to=` (company days `YYYY-MM-DD`, default the last 30
 * days), `?day=` for one day, `?userId=` for one person's timeline. A round's answers are shown to the owner and the space's
 * ADMIN always, and to anybody else only for the rounds where they answered themselves.
 */
const schema = z.object({
  workspaceId: z.string().min(1).max(64).optional(),
  userId: z.string().min(1).max(64).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  day: z.string().max(10).optional(),
});

export async function GET(req: Request) {
  return withApi(async () => {
    const q = parse(schema, Object.fromEntries([...new URL(req.url).searchParams.entries()].filter(([, v]) => v !== "")));
    return NextResponse.json(await history(await resolveSpaceId(q.workspaceId), q), { headers: { "Cache-Control": "no-store" } });
  });
}
