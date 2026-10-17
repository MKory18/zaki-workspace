import { NextResponse } from "next/server";
import { requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { getProjectTimeline } from "@/server/services/timeline";

/** GET /api/projects/:id/timeline — workspace-scoped Gantt data. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const data = await getProjectTimeline(params.id);
    await requireWorkspace(data.project.workspaceId);
    return NextResponse.json(data);
  });
}
