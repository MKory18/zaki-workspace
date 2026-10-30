import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { addStep, listSteps } from "@/server/services/task-steps";

/**
 * «خطوات» of one task — its short checklist.
 *
 *  GET   the steps in order, and the progress («3 من 5»).
 *  POST  one step: `{ title }`. Whoever may edit the task; a guest never; the owner reading silently never.
 *
 * Every guard (the task's space and team, the tasks row, the company's `taskSteps` switch) lives in the service.
 */
const addSchema = z.object({ title: z.string().min(1).max(2000) });

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json(await listSteps(params.id)));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(addSchema, req);
    return NextResponse.json({ step: await addStep(params.id, input.title) }, { status: 201 });
  });
}
