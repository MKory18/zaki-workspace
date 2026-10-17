import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { createGoal, goalSchema, listGoals } from "@/server/services/goals";

/** GET: all goals of the caller's org. */
export async function GET() {
	return withApi(async () => {
		const user = await requireUser();
		const membership = await db.organizationMember.findFirst({
			where: { userId: user.id },
			orderBy: { createdAt: "asc" },
			select: { organizationId: true },
		});
		if (!membership) return NextResponse.json({ goals: [] });
		const goals = await listGoals(membership.organizationId);
		return NextResponse.json({ goals });
	});
}

/** POST: create a goal (OWNER/ADMIN). */
export async function POST(req: Request) {
	return withApi(async () => {
		const input = await parseJson(goalSchema, req);
		const user = await requireUser();
		const membership = await db.organizationMember.findFirst({
			where: { userId: user.id },
			orderBy: { createdAt: "asc" },
			select: { organizationId: true },
		});
		if (!membership) return NextResponse.json({ error: "auth.required" }, { status: 401 });
		const goal = await createGoal({ orgId: membership.organizationId, userId: user.id }, input);
		return NextResponse.json({ goal }, { status: 201 });
	});
}
