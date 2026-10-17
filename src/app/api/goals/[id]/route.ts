import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { deleteGoal, goalPatchSchema, updateGoal } from "@/server/services/goals";

async function orgOf(userId: string) {
	const membership = await db.organizationMember.findFirst({
		where: { userId },
		orderBy: { createdAt: "asc" },
		select: { organizationId: true },
	});
	return membership?.organizationId ?? null;
}

/** PATCH: edit a goal incl. live progress (OWNER/ADMIN). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const input = await parseJson(goalPatchSchema, req);
		const user = await requireUser();
		const orgId = await orgOf(user.id);
		if (!orgId) return NextResponse.json({ error: "auth.required" }, { status: 401 });
		await updateGoal({ orgId, userId: user.id }, params.id, input);
		return NextResponse.json({ ok: true });
	});
}

/** DELETE: remove a goal (OWNER/ADMIN). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const user = await requireUser();
		const orgId = await orgOf(user.id);
		if (!orgId) return NextResponse.json({ error: "auth.required" }, { status: 401 });
		await deleteGoal({ orgId, userId: user.id }, params.id);
		return NextResponse.json({ ok: true });
	});
}
