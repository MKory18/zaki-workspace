import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { createRoutine, listRoutines, routineSchema } from "@/server/services/production";

/** GET: all routines (admin manage view). */
export async function GET() {
	return withApi(async () => {
		const user = await requireUser();
		const membership = await db.organizationMember.findFirst({
			where: { userId: user.id },
			orderBy: { createdAt: "asc" },
			select: { organizationId: true },
		});
		if (!membership) return NextResponse.json({ routines: [] });
		const routines = await listRoutines(membership.organizationId);
		return NextResponse.json({ routines });
	});
}

/** POST: create a recurring daily-production routine (OWNER/ADMIN). */
export async function POST(req: Request) {
	return withApi(async () => {
		const input = await parseJson(routineSchema, req);
		const user = await requireUser();
		const membership = await db.organizationMember.findFirst({
			where: { userId: user.id },
			orderBy: { createdAt: "asc" },
			select: { organizationId: true },
		});
		if (!membership) return NextResponse.json({ error: "auth.required" }, { status: 401 });
		const routine = await createRoutine({ orgId: membership.organizationId, userId: user.id }, input);
		return NextResponse.json({ routine }, { status: 201 });
	});
}
