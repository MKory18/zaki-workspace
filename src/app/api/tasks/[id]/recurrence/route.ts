import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, requireTaskAccess } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { getRecurrence, setRecurrence, stopRecurrence } from "@/server/services/task-recurrence";
import { RECURRENCE_MODES, ruleInputSchema } from "@/lib/task-recurrence";

/**
 * «تكرار» of one task — the series it belongs to («مهمة متكررة»).
 *
 *  GET     the series (or null) and the company's time zone.
 *  PUT     `{ rule, mode, endsOn }`: start the series, or change it (from any task of the series). Whoever may edit the
 *          task; a guest never; the owner reading silently never. The rule is `{kind:"DAILY"}`, `{kind:"WEEKLY",days:[0..6]}`,
 *          `{kind:"MONTHLY",day?}` or `{kind:"YEARLY"}`; `mode` is `ON_COMPLETE` or `SCHEDULE`; `endsOn` is `YYYY-MM-DD` or null.
 *  DELETE  stop the series: every task already made stays.
 *
 * Every guard (the task's space and team, the tasks row, the company's `recurringTasks` switch) lives in the service.
 */
const putSchema = z.object({
  rule: ruleInputSchema,
  mode: z.enum(RECURRENCE_MODES),
  endsOn: z.string().min(1).max(10).nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json(await getRecurrence(params.id)));
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(putSchema, req);
    const state = await setRecurrence(params.id, { rule: input.rule, mode: input.mode, endsOn: input.endsOn ?? null });
    const ctx = await requireTaskAccess(params.id);
    await audit("task.recurrence_set", { actorId: ctx.userId, orgId: ctx.orgId, target: params.id });
    return NextResponse.json(state);
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const state = await stopRecurrence(params.id);
    const ctx = await requireTaskAccess(params.id);
    await audit("task.recurrence_stopped", { actorId: ctx.userId, orgId: ctx.orgId, target: params.id });
    return NextResponse.json(state);
  });
}
