import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { taskTimeCard } from "@/server/services/time-tracking";

/**
 * «الوقت» of one task: the viewer's own entries (everybody's, for the space's OWNER/ADMIN), the total, and the viewer's
 * own running timer. A guest never; the company's `timeTracking` switch closes it (404). Every guard is in the service.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json(await taskTimeCard(params.id), { headers: { "Cache-Control": "no-store" } }));
}
