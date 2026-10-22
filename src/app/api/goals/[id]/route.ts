import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { deleteGoal, goalPatchSchema, updateGoal } from "@/server/services/goals";

/** PATCH: edit a goal incl. live progress (OWNER/ADMIN). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const input = await parseJson(goalPatchSchema, req);
		const actor = await requireActor();
		await updateGoal({ orgId: actor.orgId, userId: actor.userId }, params.id, input);
		return NextResponse.json({ ok: true });
	});
}

/** DELETE: remove a goal (OWNER/ADMIN). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const actor = await requireActor();
		await deleteGoal({ orgId: actor.orgId, userId: actor.userId }, params.id);
		return NextResponse.json({ ok: true });
	});
}
