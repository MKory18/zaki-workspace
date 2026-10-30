import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { deleteEntry, updateEntry } from "@/server/services/time-tracking";

/**
 * One time entry: change it (`{ note?, date?, hours?, minutes? }`) or delete it. Its owner within 14 days of creating
 * it, or the space's OWNER/ADMIN always; anybody else gets «not found». Every change keeps the previous values in the
 * audit trail (written in the same transaction), and a day never holds more than 24 hours.
 */
const patchSchema = z
  .object({
    note: z.string().max(2000).optional(),
    date: z.string().min(1).max(10).optional(),
    hours: z.number().optional(),
    minutes: z.number().optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    return NextResponse.json({ entry: await updateEntry(params.id, input) });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    await deleteEntry(params.id);
    return NextResponse.json({ ok: true });
  });
}
