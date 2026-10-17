import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { NotFoundError, requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { setTaskCompletion } from "@/server/services/tasks";
import { dispatchEvent } from "@/server/services/n8n";

const bodySchema = z.object({ complete: z.boolean() });

/** Complete/reopen a task via its board's done column. MEMBERS+; GUESTs rejected. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { complete } = await parseJson(bodySchema, req);
    const task = await db.task.findFirst({
      where: { id: params.id },
      select: { id: true, workspaceId: true },
    });
    if (!task) throw new NotFoundError("task.not_found");
    const ctx = await requireWorkspace(task.workspaceId, ["ADMIN", "MEMBER"]);
    const updated = await setTaskCompletion(ctx, params.id, complete);
    await dispatchEvent(ctx.orgId, "task.completed", {
      taskId: updated.id,
      number: updated.number,
      title: updated.title,
      completed: complete,
    });
    return NextResponse.json({ task: updated });
  });
}
