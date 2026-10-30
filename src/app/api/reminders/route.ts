import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { createReminder, listMyReminders } from "@/server/services/reminders";
import { orgTimeZone } from "@/server/services/org-day";

/**
 * «تذكيراتي» — a person's reminders for THEMSELVES. Only the signed-in person's own are ever listed or written;
 * the company's `reminders` switch is checked in the service (off: «not found»).
 *
 *  GET   my reminders: the ones that fired and wait for «تمّ», then the ones still to come, and the company's zone.
 *  POST  one: `{ title, dueAt, repeat?, taskId? | messageId? }`. `dueAt` is `2026-11-05T09:30` in the COMPANY's
 *        zone (what a datetime-local box sends) or a full instant.
 */
const createSchema = z.object({
  title: z.string().min(1).max(2000),
  dueAt: z.string().min(1).max(40),
  repeat: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]).optional(),
  taskId: z.string().min(1).nullable().optional(),
  messageId: z.string().min(1).nullable().optional(),
});

export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ reminders: await listMyReminders(actor), timeZone: await orgTimeZone(actor.orgId) }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const actor = await requireActor();
    return NextResponse.json({ reminder: await createReminder(actor, input) }, { status: 201 });
  });
}
