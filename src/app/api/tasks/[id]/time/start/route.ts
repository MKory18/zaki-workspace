import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { startTimer } from "@/server/services/time-tracking";

/**
 * «ابدأ» — starts the signed-in person's timer on this task. A person has ONE running timer: another one is closed
 * (the answer carries it as `stopped`, so the screen can say so). The start is the SERVER's clock; no body is read.
 * A guest never; the owner reading a space he is not in never (403).
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json(await startTimer(params.id), { status: 201 }));
}
