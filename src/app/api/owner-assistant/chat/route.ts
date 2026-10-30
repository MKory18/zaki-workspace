import { NextResponse } from "next/server";
import { noStore, readJson, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { sendMessage } from "@/server/services/owner-assistant-chat";

/**
 * «مساعد المالك» — ONE QUESTION. OWNER ONLY.
 *
 *   POST { message, conversationId?, range? | from? & to? (at most 92 days), space? }
 *
 * The answer carries the reply (real names put back for the owner's eyes), the proposals (each PENDING: nothing has been done),
 * the exact request that was sent to the model («شو انبعت للنموذج»), what the filter masked, and the usage meter. A refusal is a
 * dictionary key: no key saved (409), the daily limit or the monthly budget reached (429), the provider failed (502).
 */
export async function POST(req: Request) {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    return NextResponse.json(await sendMessage(access, await readJson(req)), noStore);
  });
}
