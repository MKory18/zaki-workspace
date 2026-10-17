import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { dayChecklist, dayIso } from "@/server/services/production";

/**
 * GET /api/production?day=YYYY-MM-DD — the daily production checklist for the
 * caller's org on that day (active routines scheduled that day + completion).
 */
export async function GET(req: Request) {
	return withApi(async () => {
		const user = await requireUser();
		const url = new URL(req.url);
		const raw = url.searchParams.get("day");
		const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : dayIso(new Date());
		const membership = await db.organizationMember.findFirst({
			where: { userId: user.id },
			orderBy: { createdAt: "asc" },
			select: { organizationId: true },
		});
		if (!membership) return NextResponse.json({ day, items: [] });
		const data = await dayChecklist(membership.organizationId, day);
		return NextResponse.json(data);
	});
}
