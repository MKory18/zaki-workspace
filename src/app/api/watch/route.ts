import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { NotFoundError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { currentSpace } from "@/server/services/current-space";
import { listWatch, startWatch, startWatchSchema } from "@/server/services/watch";

/** «نتفرّج سوا» of the space the person is in. Not an external partner's (the tab is not theirs). */
async function here() {
  const ctx = await activeOrgCtx();
  assertNotGuest(ctx);
  const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
  if (!space) throw new NotFoundError("watch.e.not_found");
  return { ctx, space };
}

/** GET: the sessions this person may see in the space they are in, live ones first. */
export async function GET() {
  return withApi(async () => {
    const { ctx, space } = await here();
    return NextResponse.json({ sessions: await listWatch(ctx, space.id) });
  });
}

/** POST: start a session from a pasted link, for the people picked (or everybody of the space's staff). */
export async function POST(req: Request) {
  return withApi(async () => {
    const { ctx, space } = await here();
    const body = await parseJson(startWatchSchema, req);
    const out = await startWatch(ctx, space.id, body);
    return NextResponse.json({ ...out, path: `/watch/${out.id}` }, { status: 201 });
  });
}
