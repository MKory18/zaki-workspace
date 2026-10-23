import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { createRoutine, listRoutines, routineSchema } from "@/server/services/production";

/** GET: all routines (admin manage view). */
export async function GET() {
	return withApi(async () => {
		const actor = await requireActor();
		const routines = await listRoutines(actor.orgId);
		return NextResponse.json({ routines });
	});
}

/** POST: create a recurring daily-production routine (OWNER/ADMIN; guests get 403 `guest.readonly`). */
export async function POST(req: Request) {
	return withApi(async () => {
		const actor = await requireActor();
		const input = await parseJson(routineSchema, req);
		const routine = await createRoutine({ orgId: actor.orgId, userId: actor.userId }, input);
		return NextResponse.json({ routine }, { status: 201 });
	});
}
