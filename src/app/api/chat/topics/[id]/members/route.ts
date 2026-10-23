import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { ValidationError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { addMember, removeMember } from "@/server/chat/topics";

const postSchema = z.object({ userId: z.string().min(1) });

/** POST: add one person to a topic (space admins/owner; restricted topics live from this). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(postSchema, req);
    const ctx = await activeOrgCtx();
    await addMember(ctx, params.id, input.userId);
    return NextResponse.json({ ok: true }, { status: 201 });
  });
}

/** DELETE: remove one person from a topic (`?userId=`). */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const userId = new URL(req.url).searchParams.get("userId");
    const parsed = z.string().min(1).safeParse(userId ?? "");
    if (!parsed.success) {
      throw new ValidationError([{ path: "userId", message: "chat.e.not_found" }]);
    }
    const ctx = await activeOrgCtx();
    await removeMember(ctx, params.id, parsed.data);
    return NextResponse.json({ ok: true });
  });
}
