import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { setTaskFieldValue } from "@/server/services/custom-fields";

/**
 * PUT `{ value }`: the value of one field on one task, in the field's canonical shape (src/lib/custom-fields.ts); an emptied
 * box (`null`, `""`, `[]`) clears it. Whoever may edit the task; never a partner; never the owner reading silently; a reward
 * task keeps its owner-only lock. 422 on a value the type refuses; a field of another project is «not found».
 */
const bodySchema = z.object({ value: z.unknown() }).refine((b) => "value" in b, { message: "validation.failed", path: ["value"] });

export async function PUT(req: Request, { params }: { params: { id: string; fieldId: string } }) {
  return withApi(async () => {
    const { value } = await parseJson(bodySchema, req);
    return NextResponse.json(await setTaskFieldValue(params.id, params.fieldId, value));
  });
}
