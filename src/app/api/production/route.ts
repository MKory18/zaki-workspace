import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { dayChecklist, dayIso } from "@/server/services/production";
import { db } from "@/server/db";
import { resolveTimeZone } from "@/lib/zoned-time";
import { assertNotGuest } from "@/server/services/guest-guard";
import { placeOf } from "@/server/services/space-place";

/**
 * GET /api/production?day=YYYY-MM-DD — the daily production checklist for the
 * caller's org on that day (active routines scheduled that day + completion).
 * Without a `day` it is the COMPANY's today (Organization.timezone), not the server's.
 */
export async function GET(req: Request) {
	return withApi(async () => {
		const actor = await requireActor();
		// the checklist names who did what: staff only, never an external partner (review C6)
		assertNotGuest({ orgRole: actor.role });
		const url = new URL(req.url);
		const raw = url.searchParams.get("day");
		if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
			return NextResponse.json(await dayChecklist(actor.orgId, raw, undefined, await placeOf(actor)));
		}
		const zone = resolveTimeZone(
			(await db.organization.findUnique({ where: { id: actor.orgId }, select: { timezone: true } }))?.timezone,
		);
		return NextResponse.json(await dayChecklist(actor.orgId, dayIso(new Date(), zone), zone, await placeOf(actor)));
	});
}
