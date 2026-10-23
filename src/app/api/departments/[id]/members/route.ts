import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { membersSchema, setMembers } from "@/server/services/departments";
import { db } from "@/server/db";
import { notifyMembership } from "@/server/notify";

/** POST: add/remove members. OWNER/ADMIN only; guests get 403 `guest.no_access` (service-enforced). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(membersSchema, req);
    await setMembers(ctx, params.id, input);
    if (input.addUserIds?.length) {
      const dept = await db.department.findUnique({
        where: { id: params.id },
        select: { name: true },
      });
      // Only people who can really be added are told: ACTIVE members of this company. A suspended
      // colleague or an id from another company would otherwise be sent the department's name.
      const addable = await db.organizationMember.findMany({
        where: { organizationId: ctx.orgId, status: "ACTIVE", userId: { in: input.addUserIds } },
        select: { userId: true },
      });
      await notifyMembership({
        userIds: addable.map((m) => m.userId),
        kind: "department",
        title: dept?.name ?? "",
        linkUrl: "/departments",
        actorId: ctx.userId,
      });
    }
    return NextResponse.json({ ok: true });
  });
}
