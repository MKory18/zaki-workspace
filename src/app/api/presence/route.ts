import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertFeatureOn } from "@/server/services/features";
import { presenceRoster } from "@/server/services/presence-roster";
import { currentSpace } from "@/server/services/current-space";
import { isFeatureOn } from "@/server/services/features";

/**
 * GET: the people dock — the company's ACTIVE staff (guests out, the viewer out) with who is at
 * their screen right now. It is the staff directory, so it keeps the `directory.view` switch and a
 * guest is refused with `guest.no_access`; the dock hides itself when the answer is a refusal.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    // the switch of the dock itself: off, the strip is not drawn and this door answers «not found»
    await assertFeatureOn(actor.orgId, "peopleDock");
    assertNotGuest({ orgRole: actor.role });
    if (!actor.caps.has("directory.view")) return NextResponse.json({ people: [], onlineCount: 0, total: 0 });
    // the people of the space I am in; the OWNER may ask for the whole company (`?scope=company`), nobody else
    const space = await currentSpace({ userId: actor.userId, orgId: actor.orgId, role: actor.role });
    const everyone = actor.isOwner && new URL(req.url).searchParams.get("scope") === "company";
    const hideOwner = await isFeatureOn(actor.orgId, "ownerHiddenOnline");
    return NextResponse.json({ ...(await presenceRoster(actor.orgId, actor.userId, { spaceId: space?.id ?? null, everyone, hideOwner })), canChooseScope: actor.isOwner, scope: everyone ? "company" : "space" }, {
      headers: { "Cache-Control": "no-store" },
    });
  });
}
