import { NextResponse } from "next/server";
import { noStore, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { listConversations } from "@/server/services/owner-assistant-chat";

/** «مساعد المالك» — the owner's own conversations, newest first. Nobody else's are ever listed. */
export async function GET() {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    return NextResponse.json({ conversations: await listConversations(access) }, noStore);
  });
}
