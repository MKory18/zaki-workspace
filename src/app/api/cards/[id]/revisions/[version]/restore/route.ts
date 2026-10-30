import { NextResponse } from "next/server";
import { withCardApi } from "@/server/card-api";
import { requireActor } from "@/server/policy/actor";
import { ValidationError } from "@/server/auth";
import { parseJson } from "@/server/validation";
import { restoreRevision, restoreSchema } from "@/server/services/card-revisions";

/** Put the card back to an older version: a NEW version with the old content (history is never rewritten). */
export async function POST(req: Request, { params }: { params: { id: string; version: string } }) {
  return withCardApi(async () => {
    const actor = await requireActor();
    const version = Number(params.version);
    if (!Number.isInteger(version) || version < 1) throw new ValidationError([{ path: "version", message: "cards.e.version" }]);
    const input = await parseJson(restoreSchema, req);
    return NextResponse.json({ card: await restoreRevision(actor, params.id, version, input.version) });
  });
}
