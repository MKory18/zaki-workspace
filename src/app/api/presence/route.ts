import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertFeatureOn } from "@/server/services/features";
import { presenceRoster } from "@/server/services/presence-roster";

/**
 * GET: the people dock — the company's ACTIVE staff (guests out, the viewer out) with who is at
 * their screen right now. It is the staff directory, so it keeps the `directory.view` switch and a
 * guest is refused with `guest.no_access`; the dock hides itself when the answer is a refusal.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    // the switch of the dock itself: off, the strip is not drawn and this door answers «not found»
    await assertFeatureOn(actor.orgId, "peopleDock");
    assertNotGuest({ orgRole: actor.role });
    if (!actor.caps.has("directory.view")) return NextResponse.json({ people: [], onlineCount: 0, total: 0 });
    return NextResponse.json(await presenceRoster(actor.orgId, actor.userId), {
      headers: { "Cache-Control": "no-store" },
    });
  });
}
