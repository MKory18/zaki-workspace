import { NextResponse } from "next/server";
import { z } from "zod";
import { NotFoundError, requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { createInstantTask } from "@/server/services/instant-work";
import { orgTimeZone } from "@/server/services/org-day";
import { dueInstantForDay, parseDayText } from "@/lib/due-day";

const schema = z.object({
  title: z.string().trim().min(1, "title.required").max(280),
  description: z.string().trim().max(4000).nullable().optional(),
  assigneeId: z.string().min(1, "instant.pick_person"),
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).default("NORMAL"),
  // a day ("2026-11-05") or a full instant: a day is noon in the COMPANY's zone, never the browser's (review B5)
  dueDate: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
});

/** POST: «مهمة فورية» in the space the person is in (src/server/services/instant-work.ts). */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(schema, req);
    const who = await activeOrgCtx();
    const space = await currentSpace({ userId: who.userId, orgId: who.orgId, role: who.orgRole });
    if (!space) throw new NotFoundError("workspace.not_found");
    const ctx = await requireWorkspace(space.id, ["ADMIN", "MEMBER"]);
    const dueDate = !input.dueDate
      ? null
      : parseDayText(input.dueDate)
        ? dueInstantForDay(input.dueDate, await orgTimeZone(ctx.orgId))
        : new Date(input.dueDate);
    const task = await createInstantTask(ctx, space.id, {
      title: input.title,
      description: input.description ?? null,
      assigneeId: input.assigneeId,
      priority: input.priority,
      dueDate,
    });
    return NextResponse.json({ task }, { status: 201 });
  });
}
