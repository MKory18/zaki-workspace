import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { setRoutineDone } from "@/server/services/production";

const toggleSchema = z.object({
	routineId: z.string().min(1),
	day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	done: z.boolean(),
});

/** POST: check/uncheck a routine for one day. Any org member may check off; guests get 403 (service). */
export async function POST(req: Request) {
	return withApi(async () => {
		const user = await requireUser();
		const input = await parseJson(toggleSchema, req);
		const membership = await db.organizationMember.findFirst({
			where: { userId: user.id },
			orderBy: { createdAt: "asc" },
			select: { organizationId: true },
		});
		if (!membership) return NextResponse.json({ error: "auth.required" }, { status: 401 });
		await setRoutineDone(
			{ orgId: membership.organizationId, userId: user.id },
			input.routineId,
			input.day,
			input.done,
		);
		return NextResponse.json({ ok: true });
	});
}
