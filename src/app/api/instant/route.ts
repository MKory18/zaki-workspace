import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { isFeatureOn } from "@/server/services/features";
import { listWorkspaceMembers } from "@/server/services/workspaces";
import { memberCan } from "@/server/policy/actor";

/**
 * GET: what «مهمة فورية» and «تذكرة فورية» may offer this person: whether each is on for them, and the people they
 * can hand one to (the people of the space they are in). A guest, or the switch off: nothing.
 */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const none = { task: false, ticket: false, space: null, people: [] };
    if (ctx.orgRole === "GUEST" || !(await isFeatureOn(ctx.orgId, "instantWork"))) return NextResponse.json(none);
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    if (!space) return NextResponse.json(none);
    const [task, ticket, members] = await Promise.all([
      memberCan(ctx, "tasks.edit"),
      memberCan(ctx, "tickets.edit"),
      listWorkspaceMembers(space.id, ctx.userId),
    ]);
    return NextResponse.json({
      task: task === true,
      ticket: ticket === true,
      space: { id: space.id, name: space.name },
      people: members.map((m) => ({ id: m.id, name: m.name })),
    });
  });
}
