import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApprovalsApi } from "@/server/approvals-api";
import { getApproval } from "@/server/services/approvals";

/** GET: the whole request (content, chain, files, earlier versions) for somebody who may read it; 404 for anybody else. Reading leaves no trace. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ approval: await getApproval(actor, params.id) });
  });
}
