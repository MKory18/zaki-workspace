import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { stopTimer } from "@/server/services/time-tracking";

/**
 * «وقّف» — closes the signed-in person's own running timer, whatever task it is on. The duration comes from the
 * server's clock (a body is not read at all); a timer past 12 hours closes at `startedAt + 12h` and is marked.
 */
export async function POST() {
  return withApi(async () => NextResponse.json({ entry: await stopTimer() }));
}
