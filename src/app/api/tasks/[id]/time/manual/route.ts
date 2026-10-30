import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { addManualEntry } from "@/server/services/time-tracking";

/**
 * «إضافة وقت يدوي» — `{ date: "YYYY-MM-DD" (the company's day), hours, minutes, note? }`. At most 24 hours an entry and 24
 * hours a person a day, never in the future. The same guards as the timer.
 */
const manualSchema = z.object({
  date: z.string().min(1).max(10),
  hours: z.number(),
  minutes: z.number(),
  note: z.string().max(2000).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(manualSchema, req);
    return NextResponse.json({ entry: await addManualEntry(params.id, input) }, { status: 201 });
  });
}
