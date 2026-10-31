import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { createField, listProjectFields } from "@/server/services/custom-fields";

/**
 * «حقول مخصصة» of one project — its schema.
 *
 *  GET   the live fields in order (`?archived=1` adds the archived ones, for the space's ADMIN and the owner). A partner gets none.
 *  POST  one field: `{ label, type, required?, unit?, currency?, options? }`. The space's ADMIN or the owner only.
 *
 * Every guard (the project's space and team, the projects row, the company's `customFields` switch) lives in the service.
 */
const optionSchema = z.object({
  id: z.string().max(64).optional(),
  label: z.string().max(200),
  color: z.string().max(20).optional(),
});

const createSchema = z.object({
  label: z.string().max(500),
  type: z.string().max(30),
  required: z.boolean().optional(),
  unit: z.string().max(200).nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  options: z.array(optionSchema).max(200).optional(),
});

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
    return NextResponse.json({ fields: await listProjectFields(params.id, { includeArchived }) });
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    return NextResponse.json({ field: await createField(params.id, input) }, { status: 201 });
  });
}
