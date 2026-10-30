import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { deleteStep, updateStep } from "@/server/services/task-steps";

/**
 * One step: rename, tick or untick, move, delete — all of them what editing the task allows.
 *
 *  PATCH  `{ title?, done?, afterId? }`; `afterId` puts the step right after that one (`null`: first).
 *  DELETE the step.
 */
const patchSchema = z
  .object({
    title: z.string().min(1).max(2000).optional(),
    done: z.boolean().optional(),
    afterId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.done !== undefined || v.afterId !== undefined, { message: "step.nothing" });

export async function PATCH(req: Request, { params }: { params: { id: string; stepId: string } }) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    return NextResponse.json({ step: await updateStep(params.id, params.stepId, input) });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; stepId: string } }) {
  return withApi(async () => {
    await deleteStep(params.id, params.stepId);
    return NextResponse.json({ ok: true });
  });
}
