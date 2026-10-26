import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { moveSchema, moveToSpace } from "@/server/services/move-to-space";

/** POST: «انقل لمساحة» — moves things that have no space yet into a space the caller can open (OWNER / ADMIN). */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(moveSchema, req);
    const actor = await requireActor();
    return NextResponse.json(await moveToSpace(actor, input));
  });
}
