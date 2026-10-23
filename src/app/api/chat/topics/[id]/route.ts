import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { setTopicClosed, updateTopic, updateTopicSchema } from "@/server/chat/topics";

const patchSchema = updateTopicSchema.extend({ closed: z.boolean().optional() });

/** PATCH: topic settings (title, emoji, restricted, posting policy) and close/reopen (`closed`). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { closed, ...input } = await parseJson(patchSchema, req);
    const ctx = await activeOrgCtx();
    if (closed !== undefined) await setTopicClosed(ctx, params.id, closed);
    if (Object.keys(input).length) await updateTopic(ctx, params.id, input);
    return NextResponse.json({ ok: true });
  });
}
