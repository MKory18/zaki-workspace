import { NextResponse } from "next/server";
import { noStore, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { rejectProposal } from "@/server/services/owner-assistant-proposals";

/** «مساعد المالك» — «ارفض»: the proposal is closed and nothing runs. 409 when it was already decided. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    return NextResponse.json({ proposal: await rejectProposal({ userId: access.userId, orgId: access.orgId, role: "OWNER" }, params.id) }, noStore);
  });
}
