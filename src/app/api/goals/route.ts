import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { assertNotGuest } from "@/server/services/guest-guard";
import { createGoal, goalSchema, listGoals } from "@/server/services/goals";

/**
 * Goals are the company's own plans (titles, descriptions, departments, who set them): staff only. An
 * external partner (guest) gets 403 `guest.no_access` from every handler here, before anything is
 * read or the body is looked at.
 */

/** GET: all goals of the caller's org (the company they are still ACTIVE in). */
export async function GET() {
	return withApi(async () => {
		const actor = await requireActor();
		assertNotGuest({ orgRole: actor.role });
		const goals = await listGoals({ orgId: actor.orgId, orgRole: actor.role });
		return NextResponse.json({ goals });
	});
}

/** POST: create a goal (OWNER/ADMIN). */
export async function POST(req: Request) {
	return withApi(async () => {
		const actor = await requireActor();
		assertNotGuest({ orgRole: actor.role });
		const input = await parseJson(goalSchema, req);
		const goal = await createGoal({ orgId: actor.orgId, userId: actor.userId }, input);
		return NextResponse.json({ goal }, { status: 201 });
	});
}
