import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { myTimeToday } from "@/server/services/time-tracking";

/**
 * «وقتي اليوم» — the signed-in person's own running timer (if any) and the finished time they logged on the company's
 * today. `serverNow` is the SERVER's clock: the screen draws its live clock from the server's `startedAt` and this.
 * The company's `timeTracking` switch and the guest rule live in the service.
 */
export async function GET() {
  return withApi(async () => NextResponse.json(await myTimeToday(), { headers: { "Cache-Control": "no-store" } }));
}
