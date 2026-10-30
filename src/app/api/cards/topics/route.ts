import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parse } from "@/server/validation";
import { postableTopics } from "@/server/services/cards";

/** The topics of the space the caller may send a card into («أرسل»). */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const { spaceId } = parse(z.object({ spaceId: z.string().min(1) }), Object.fromEntries(new URL(req.url).searchParams.entries()));
    return NextResponse.json({ topics: await postableTopics(actor, spaceId) });
  });
}
