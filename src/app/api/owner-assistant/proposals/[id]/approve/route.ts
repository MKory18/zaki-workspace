import { NextResponse } from "next/server";
import { noStore, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { approveProposal } from "@/server/services/owner-assistant-proposals";

/**
 * «مساعد المالك» — «وافق». The ONLY way a proposal runs, and it runs once: a second click, or two at once, answer 409. It goes
 * through the ordinary services as the owner (the rank rule, the reward lock, the space rules and the activity log all apply).
 * The answer is the proposal as it is now: APPROVED with its result, or FAILED with an Arabic reason.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    return NextResponse.json({ proposal: await approveProposal({ userId: access.userId, orgId: access.orgId, role: "OWNER" }, params.id) }, noStore);
  });
}
