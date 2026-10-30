import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { dismissReminder, snoozeReminder } from "@/server/services/reminders";

/**
 * One reminder of the signed-in person (anybody else's is «not found»).
 *
 *  PATCH   `{ snooze: "HOUR" | "TOMORROW_MORNING" }`: due again in an hour, or tomorrow at 09:00 company time.
 *  DELETE  «تمّ»: the reminder is over.
 */
const snoozeSchema = z.object({ snooze: z.enum(["HOUR", "TOMORROW_MORNING"]) });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(snoozeSchema, req);
    const actor = await requireActor();
    return NextResponse.json({ reminder: await snoozeReminder(actor, params.id, input.snooze) });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    await dismissReminder(actor, params.id);
    return NextResponse.json({ ok: true });
  });
}
