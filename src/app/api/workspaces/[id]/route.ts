import { NextResponse } from "next/server";
import { z } from "zod";
import { NotFoundError, audit, requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";

const renameSchema = z.object({
  name: z.string().trim().min(2, "name.too_short").max(80, "name.too_long"),
  description: z.string().trim().max(300).nullable().optional(),
});

/** PATCH: rename / re-describe a workspace. Workspace ADMIN or org OWNER/ADMIN. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(renameSchema, req);
    const ws = await db.workspace.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    });
    if (!ws) throw new NotFoundError("workspace.not_found");
    const ctx = await requireWorkspace(ws.id, ["ADMIN"]);
    const updated = await db.workspace.update({
      where: { id: ws.id },
      data: { name: input.name, description: input.description ?? undefined },
      select: { id: true, name: true, description: true },
    });
    await audit("workspace.renamed", {
      actorId: ctx.userId,
      orgId: ws.organizationId,
      target: ws.id,
      meta: { name: input.name },
    });
    return NextResponse.json({ workspace: updated });
  });
}
