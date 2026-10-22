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
      await notifyMembership({
        userIds: input.addUserIds,
        kind: "department",
        title: dept?.name ?? "",
        linkUrl: "/departments",
        actorId: ctx.userId,
      });
    }
    return NextResponse.json({ ok: true });
  });
}
