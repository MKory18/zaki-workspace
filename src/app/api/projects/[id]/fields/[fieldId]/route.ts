import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { updateField } from "@/server/services/custom-fields";

/**
 * One field of a project: PATCH `{ label?, required?, archived?, unit?, currency?, options?, afterId? }`.
 * Archiving hides the field and keeps every value. `afterId` moves it right after another field (`null`: first).
 * The space's ADMIN or the owner only; a field id of another project is «not found».
 */
const patchSchema = z.object({
  label: z.string().max(500).optional(),
  required: z.boolean().optional(),
  archived: z.boolean().optional(),
  unit: z.string().max(200).nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  options: z.array(z.object({ id: z.string().max(64).optional(), label: z.string().max(200), color: z.string().max(20).optional() })).max(200).optional(),
  afterId: z.string().min(1).max(64).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string; fieldId: string } }) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    return NextResponse.json({ field: await updateField(params.id, params.fieldId, input) });
  });
}
