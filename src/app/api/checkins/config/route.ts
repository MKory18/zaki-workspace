import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parse, parseJson } from "@/server/validation";
import { getConfig, saveConfig } from "@/server/services/checkins";
import { resolveSpaceId } from "@/server/services/checkins-space";

/**
 * «التسجيل اليومي» — the settings of a space's check-in, for its ADMIN and the owner (everybody else: 403).
 *
 *  GET  ?workspaceId=  the configuration (or the defaults) and the people who may be chosen as participants.
 *  PUT  `{ workspaceId?, active, questions[1..5], timeOfDay "HH:MM", weekdays[0..6], participantsMode, participantIds? }`.
 *
 * Every rule is in the service; the schema here only bounds the sizes.
 */
const putSchema = z.object({
  workspaceId: z.string().min(1).max(64).optional(),
  active: z.boolean(),
  questions: z.array(z.string().max(400)).max(10),
  timeOfDay: z.string().max(10),
  weekdays: z.array(z.number()).max(10),
  participantsMode: z.string().max(10),
  participantIds: z.array(z.string().max(64)).max(500).optional(),
});

export async function GET(req: Request) {
  return withApi(async () => {
    const { searchParams } = new URL(req.url);
    const q = parse(z.object({ workspaceId: z.string().min(1).max(64).optional() }), { workspaceId: searchParams.get("workspaceId") || undefined });
    return NextResponse.json(await getConfig(await resolveSpaceId(q.workspaceId)), { headers: { "Cache-Control": "no-store" } });
  });
}

export async function PUT(req: Request) {
  return withApi(async () => {
    const { workspaceId, ...input } = await parseJson(putSchema, req);
    return NextResponse.json({ config: await saveConfig(await resolveSpaceId(workspaceId), input) });
  });
}
