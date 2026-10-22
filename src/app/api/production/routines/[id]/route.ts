import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { deleteRoutine, routineSchema, updateRoutine } from "@/server/services/production";

/** PATCH: edit a routine (OWNER/ADMIN; guests get 403 `guest.readonly`). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const actor = await requireActor();
		const input = await parseJson(routineSchema, req);
		await updateRoutine({ orgId: actor.orgId, userId: actor.userId }, params.id, input);
		return NextResponse.json({ ok: true });
	});
}

/** DELETE: remove a routine (OWNER/ADMIN; guests get 403 `guest.readonly`). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const actor = await requireActor();
		await deleteRoutine({ orgId: actor.orgId, userId: actor.userId }, params.id);
		return NextResponse.json({ ok: true });
	});
}
