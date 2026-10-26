import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { NotFoundError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { startMeeting } from "@/server/calls/calls";

const meetingSchema = z.object({ title: z.string().trim().max(80).nullable().default(null), video: z.boolean().default(true) });

/** POST: open a meeting (a call with a link) in the space the person is in. */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = await parseJson(meetingSchema, req);
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    if (!space) throw new NotFoundError("calls.e.not_found");
    const out = await startMeeting(ctx, space.id, { title: body.title || null, video: body.video });
    return NextResponse.json({ id: out.id, path: `/calls/${out.id}` }, { status: 201 });
  });
}
