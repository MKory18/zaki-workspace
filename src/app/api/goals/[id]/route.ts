import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { assertNotGuest } from "@/server/services/guest-guard";
import { deleteGoal, goalPatchSchema, updateGoal } from "@/server/services/goals";

/** Goals are staff only: an external partner (guest) gets 403 `guest.no_access` before anything is read. */

/** PATCH: edit a goal incl. live progress (OWNER/ADMIN). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const actor = await requireActor();
		assertNotGuest({ orgRole: actor.role });
		const input = await parseJson(goalPatchSchema, req);
		await updateGoal({ orgId: actor.orgId, userId: actor.userId }, params.id, input);
		return NextResponse.json({ ok: true });
	});
}

/** DELETE: remove a goal (OWNER/ADMIN). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const actor = await requireActor();
		assertNotGuest({ orgRole: actor.role });
		await deleteGoal({ orgId: actor.orgId, userId: actor.userId }, params.id);
		return NextResponse.json({ ok: true });
	});
}
