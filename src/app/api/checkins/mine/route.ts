import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { cardState } from "@/server/services/checkins";
import { resolveSpaceId } from "@/server/services/checkins-space";

/** The card on «اليوم»: where I stand in this space's round today (`none` draws nothing). */
export async function GET() {
  return withApi(async () => NextResponse.json({ state: await cardState(await resolveSpaceId(null)) }, { headers: { "Cache-Control": "no-store" } }));
}
