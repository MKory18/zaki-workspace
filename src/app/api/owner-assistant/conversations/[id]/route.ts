import { NextResponse } from "next/server";
import { noStore, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { deleteConversation, getConversation } from "@/server/services/owner-assistant-chat";

/** «مساعد المالك» — one conversation with its messages and proposals (404 for somebody else's), or «امسح المحادثة». */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    return NextResponse.json({ conversation: await getConversation(access, params.id) }, noStore);
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    await deleteConversation(access, params.id);
    return NextResponse.json({ ok: true }, noStore);
  });
}
