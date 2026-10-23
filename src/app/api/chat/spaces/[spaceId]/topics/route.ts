import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { createTopic, createTopicSchema } from "@/server/chat/topics";

const bodySchema = createTopicSchema.omit({ spaceId: true }).extend({ spaceId: z.string().min(1).optional() });

/** POST: open a new topic in a space (a space admin of that space, or the owner). */
export async function POST(req: Request, { params }: { params: { spaceId: string } }) {
  return withApi(async () => {
    const body = await parseJson(bodySchema, req);
    const ctx = await activeOrgCtx();
    const result = await createTopic(ctx, { ...body, spaceId: body.spaceId ?? params.spaceId });
    return NextResponse.json(result, { status: 201 });
  });
}
