import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { readTaskFields } from "@/server/services/custom-fields";

/**
 * «حقول مخصصة» of one task: the project's live fields and the values this task holds (`values`: field id -> value).
 * Whoever may read the task reads this, except an external partner, who is handed an empty card; the company's switch is
 * checked in the service (404 while it is off). Values are written one at a time at `/fields/[fieldId]`.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json(await readTaskFields(params.id)));
}
