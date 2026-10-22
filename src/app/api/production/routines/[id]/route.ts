import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { deleteRoutine, routineSchema, updateRoutine } from "@/server/services/production";

async function orgOf(userId: string) {
	const membership = await db.organizationMember.findFirst({
		where: { userId },
		orderBy: { createdAt: "asc" },
		select: { organizationId: true },
	});
	return membership?.organizationId ?? null;
}

/** PATCH: edit a routine (OWNER/ADMIN; guests get 403 `guest.readonly`). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const user = await requireUser();
		const input = await parseJson(routineSchema, req);
		const orgId = await orgOf(user.id);
		if (!orgId) return NextResponse.json({ error: "auth.required" }, { status: 401 });
		await updateRoutine({ orgId, userId: user.id }, params.id, input);
		return NextResponse.json({ ok: true });
	});
}

/** DELETE: remove a routine (OWNER/ADMIN; guests get 403 `guest.readonly`). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const user = await requireUser();
		const orgId = await orgOf(user.id);
		if (!orgId) return NextResponse.json({ error: "auth.required" }, { status: 401 });
		await deleteRoutine({ orgId, userId: user.id }, params.id);
		return NextResponse.json({ ok: true });
	});
}
