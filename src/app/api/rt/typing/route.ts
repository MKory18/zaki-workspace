import { z } from "zod";
import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { NotFoundError, requireUser } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { allowTyping, broadcastTyping } from "@/server/realtime/hub";

/**
 * POST /api/rt/typing {conversationId} — "يكتب الآن…" for the OTHER viewers of a
 * conversation. Never stored: in-memory only, 6 s expiry in the hub. A person who
 * cannot read the conversation gets 404 (the conversation is invisible, not forbidden).
 * The OWNER in oversight cannot emit typing; once he has joined («شارك بالمحادثة»)
 * he is a normal member and can.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY = z.object({ conversationId: z.string().min(1) });

export async function POST(req: Request): Promise<NextResponse> {
  return withApi(async () => {
    const actor = await requireActor();
    const body = BODY.parse(await req.json().catch(() => ({})));

    const conversation = await db.conversation.findUnique({
      where: { id: body.conversationId },
      select: { id: true, orgId: true },
    });
    if (!conversation || conversation.orgId !== actor.orgId) throw new NotFoundError("chat.not_found");

    // Visibility through the policy seam: a person who cannot READ the conversation
    // gets 404. Posting is NOT required (a read-only announcements member still sees
    // "يكتب الآن…"), but a person who cannot read is nobody here.
    const { canReadConversation } = await import("@/server/realtime/policy-gate");
    if (!(await canReadConversation(actor.userId, conversation.id))) throw new NotFoundError("chat.not_found");

    // The owner's silent oversight never emits typing: only a JOINED owner (he has a
    // ConversationMember row) may.
    const member = await db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId: actor.userId } },
      select: { id: true },
    });
    if (!member && actor.isOwner) {
      // oversight read: silent, nothing emitted
      return new NextResponse(null, { status: 204 });
    }

    if (!allowTyping(`${actor.userId}|${conversation.id}`)) {
      return new NextResponse(null, { status: 204 });
    }

    const user = await requireUser();
    await broadcastTyping(actor.orgId, conversation.id, actor.userId, user.name);
    return new NextResponse(null, { status: 204 });
  });
}
