import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { dayChecklist, dayIso } from "@/server/services/production";

/**
 * GET /api/production?day=YYYY-MM-DD — the daily production checklist for the
 * caller's org on that day (active routines scheduled that day + completion).
 */
export async function GET(req: Request) {
	return withApi(async () => {
		const actor = await requireActor();
		const url = new URL(req.url);
		const raw = url.searchParams.get("day");
		const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : dayIso(new Date());
		const data = await dayChecklist(actor.orgId, day);
		return NextResponse.json(data);
	});
}
