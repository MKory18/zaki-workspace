import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { listFeatures, setFeature } from "@/server/services/features";
import { FEATURES } from "@/lib/features";

const switchSchema = z.object({ key: z.enum(FEATURES), on: z.boolean() });

/** GET: every switch of the company and whether it is on (staff may read it; only the owner switches). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    return NextResponse.json({ features: await listFeatures(ctx.orgId) });
  });
}

/** PATCH: one switch on or off — the owner's alone. */
export async function PATCH(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = await parseJson(switchSchema, req);
    return NextResponse.json(await setFeature(ctx, body.key, body.on));
  });
}
