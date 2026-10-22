import { NextResponse } from "next/server";
import { ProjectStatus } from "@prisma/client";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { db } from "@/server/db";
import { NotFoundError, ForbiddenError, requireWorkspace } from "@/server/auth";
import { audit } from "@/server/auth";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  status: z.string().max(24).optional(),
  priority: z.string().max(16).optional(),
  startDate: z.coerce.date().optional().nullable(),
  targetDate: z.coerce.date().optional().nullable(),
  departmentId: z.string().min(1).optional().nullable(),
});

/** PATCH: project fields incl. department binding (dept must live in the project's org). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    const project = await db.project.findUnique({ where: { id: params.id }, select: { id: true, workspaceId: true } });
    if (!project) throw new NotFoundError("project.not_found");
    const ctx = await requireWorkspace(project.workspaceId, ["ADMIN", "MEMBER"]);

    if (input.departmentId) {
      const dept = await db.department.findFirst({
        where: { id: input.departmentId, orgId: ctx.orgId },
        select: { id: true },
      });
      if (!dept) throw new ForbiddenError("dept.not_found");
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.startDate !== undefined) data.startDate = input.startDate ?? null;
    if (input.targetDate !== undefined) data.targetDate = input.targetDate ?? null;
    if (input.departmentId !== undefined) data.departmentId = input.departmentId ? input.departmentId : null;
    // every real status; a value that is not one is ignored (it used to whitelist a status that does not exist)
    if (input.status && (Object.values(ProjectStatus) as string[]).includes(input.status)) {
      data.status = input.status;
    }
    if (input.priority && ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"].includes(input.priority)) {
      data.priority = input.priority;
    }

    const updated = await db.project.update({
      where: { id: project.id },
      data,
      select: { id: true, name: true, status: true, departmentId: true },
    });
    await audit("project.updated", { target: project.id, meta: { name: updated.name } });
    return NextResponse.json({ project: updated });
  });
}
