import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { NotFoundError, requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { dispatchEvent } from "@/server/services/n8n";
import { notifyComment } from "@/server/notify";

const commentSchema = z.object({
  body: z.string().trim().min(1, "comment.required").max(10_000),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  return withApi(async () => {
        const input = await parseJson(commentSchema, req);
    const task = await db.task.findFirst({
      where: { id: params.id },
      select: {
        id: true,
        workspaceId: true,
        number: true,
        assigneeId: true,
        creatorId: true,
        organization: { select: { keyPrefix: true } },
      },
    });
    if (!task) throw new NotFoundError("task.not_found");
    const ctx = await requireWorkspace(task.workspaceId);
    const comment = await db.taskComment.create({
      data: { taskId: task.id, authorId: ctx.userId, body: input.body },
      include: { author: { select: { id: true, name: true } } },
    });
    await db.taskActivity.create({
      data: { taskId: task.id, actorId: ctx.userId, event: "task.commented" },
    });
    await dispatchEvent(ctx.orgId, "comment.created", { taskId: task.id, commentId: comment.id });
    await notifyComment({
      taskId: task.id,
      taskNumber: task.number,
      orgPrefix: task.organization.keyPrefix,
      authorId: ctx.userId,
      authorName: comment.author.name,
      body: input.body,
      watcherIds: [task.assigneeId, task.creatorId].filter((x): x is string => x !== null),
    });
    return NextResponse.json({ comment }, { status: 201 });
  });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const task = await db.task.findFirst({
      where: { id: params.id },
      select: { workspaceId: true },
    });
    if (!task) throw new NotFoundError("task.not_found");
    await requireWorkspace(task.workspaceId);
    const comments = await db.taskComment.findMany({
      where: { taskId: params.id },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ comments });
  });
}
