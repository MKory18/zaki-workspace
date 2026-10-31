import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { myHideLastSeen, setHideLastSeen } from "@/server/services/last-seen";

const hideSchema = z.object({ hide: z.boolean({ invalid_type_error: "lastSeen.e.invalid", required_error: "lastSeen.e.invalid" }) }).strict();

/**
 * PATCH `{ hide: boolean }`: «إخفاء آخر ظهوري» — the caller's own choice, kept on their own membership row (nobody else's
 * is ever touched). Hidden, nobody but the owner sees when they were last here; and, like a messenger, they stop seeing
 * anybody else's. Online status is not affected. `GET` tells the caller their current choice.
 *
 * A switched-off «آخر ظهور» (`الميزات`) answers «not found» (404 `features.off`); an external partner has nothing to hide
 * and is refused (403 `guest.no_access`); anything but a strict `{ hide: boolean }` is a 422.
 */
export async function PATCH(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    await assertFeatureOn(actor.orgId, "lastSeen");
    const { hide } = await parseJson(hideSchema, req);
    return NextResponse.json({ ok: true, ...(await setHideLastSeen(actor, hide)) });
  });
}

export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    await assertFeatureOn(actor.orgId, "lastSeen");
    return NextResponse.json({ hide: await myHideLastSeen(actor.orgId, actor.userId) }, { headers: { "Cache-Control": "no-store" } });
  });
}
