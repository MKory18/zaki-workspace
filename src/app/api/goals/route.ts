import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { createGoal, goalSchema, listGoals } from "@/server/services/goals";

/** GET: all goals of the caller's org (the company they are still ACTIVE in). */
export async function GET() {
	return withApi(async () => {
		const actor = await requireActor();
		const goals = await listGoals(actor.orgId);
		return NextResponse.json({ goals });
	});
}

/** POST: create a goal (OWNER/ADMIN). */
export async function POST(req: Request) {
	return withApi(async () => {
		const input = await parseJson(goalSchema, req);
		const actor = await requireActor();
		const goal = await createGoal({ orgId: actor.orgId, userId: actor.userId }, input);
		return NextResponse.json({ goal }, { status: 201 });
	});
}
