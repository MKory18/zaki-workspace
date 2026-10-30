import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireTaskAccess } from "@/server/auth";
import { assertFeatureOn } from "@/server/services/features";
import { removeTaskLink } from "@/server/services/task-links";

/**
 * DELETE: removes one link of this task, named by its own id. A link of two other tasks is not this
 * task's to delete (the service only finds one that touches the task in the path).
 */
export async function DELETE(_req: Request, { params }: { params: { id: string; linkId: string } }) {
  return withApi(async () => {
    const access = await requireTaskAccess(params.id);
    await assertFeatureOn(access.orgId, "taskLinks");
    await removeTaskLink(params.id, params.linkId);
    return NextResponse.json({ ok: true });
  });
}
