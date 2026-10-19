import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { requireWorkspace, NotFoundError } from "@/server/auth";
import { withApi } from "@/server/api";
import { getProjectTimeline } from "@/server/services/timeline";

/** GET /api/projects/:id/timeline — workspace-scoped Gantt data. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    // authorize BEFORE fetching data: resolve the project's workspace first
    const project = await db.project.findUnique({
      where: { id: params.id },
      select: { workspaceId: true },
    });
    if (!project) throw new NotFoundError("project.not_found");
    await requireWorkspace(project.workspaceId);
    const data = await getProjectTimeline(params.id);
    return NextResponse.json(data);
  });
}
