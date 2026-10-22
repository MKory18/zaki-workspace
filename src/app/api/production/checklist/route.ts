import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
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
		const actor = await requireActor();
		const input = await parseJson(toggleSchema, req);
		await setRoutineDone(
			{ orgId: actor.orgId, userId: actor.userId },
			input.routineId,
			input.day,
			input.done,
		);
		return NextResponse.json({ ok: true });
	});
}
