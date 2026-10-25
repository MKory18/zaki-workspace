import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { createGroup, listDms, openDm } from "@/server/chat/dm";

const createDmSchema = z.object({ kind: z.literal("DM"), userId: z.string().min(1) });
const createGroupSchema = z.object({
  kind: z.literal("GROUP"),
  title: z.string().trim().min(2).max(60),
  emoji: z.string().trim().max(16, "chat.bad_emoji").optional().nullable(),
  memberIds: z.array(z.string().min(1)).min(1, "chat.group_needs_members").max(50),
});
const bodySchema = z.discriminatedUnion("kind", [createDmSchema, createGroupSchema]);

/** GET: my DM conversations (+ unread counts + last message preview). Guests get 403 (service). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    return NextResponse.json({ conversations: await listDms(ctx, space?.id ?? null) });
  });
}

/** POST: open a DM with one member or create a group. */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(bodySchema, req);
    const ctx = await activeOrgCtx();
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const result = input.kind === "DM"
      ? await openDm(ctx, input.userId, space?.id ?? null)
      : await createGroup(ctx, { title: input.title, memberIds: input.memberIds, emoji: input.emoji });
    return NextResponse.json({ id: result.id }, { status: 201 });
  });
}
