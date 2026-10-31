import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { submitAnswer } from "@/server/services/checkins";
import { resolveSpaceId } from "@/server/services/checkins-space";

/**
 * «التسجيل اليومي» — submit my answer to today's round, or edit it until the round closes (the end of the company's day).
 * `{ workspaceId?, day?, answers: string[] (one per question, each <= 1000), taskIds?: string[] }`. The time is the SERVER's:
 * a late answer is refused whatever the browser says.
 */
const schema = z.object({
  workspaceId: z.string().min(1).max(64).optional(),
  day: z.string().max(10).nullable().optional(),
  answers: z.array(z.string().max(5000)).max(10),
  taskIds: z.array(z.string().max(64)).max(50).optional(),
});

export async function POST(req: Request) {
  return withApi(async () => {
    const { workspaceId, ...input } = await parseJson(schema, req);
    return NextResponse.json(await submitAnswer(await resolveSpaceId(workspaceId), input));
  });
}
