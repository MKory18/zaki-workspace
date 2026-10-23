import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { togglePin } from "@/server/chat/messages";

/** POST: pin/unpin — the participants of a DM, or a space admin in topics (service-enforced). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const result = await togglePin(ctx, params.id);
    return NextResponse.json(result);
  });
}
