import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { requireWorkspace, audit } from "@/server/auth";
import { withApi } from "@/server/api";
import { parse, parseJson } from "@/server/validation";

const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  startDate: z.coerce.date().optional().nullable(),
  targetDate: z.coerce.date().optional().nullable(),
});

/** Projects visible to the caller in the given workspace. */
export async function GET(req: Request) {
  return withApi(async () => {
    const url = new URL(req.url);
    const { workspaceId } = parse(
      z.object({ workspaceId: z.string().min(1) }),
      Object.fromEntries(url.searchParams),
    );
    const ctx = await requireWorkspace(workspaceId);
    const projects = await db.project.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        priority: true,
        startDate: true,
        targetDate: true,
        ownerId: true,
        updatedAt: true,
        _count: { select: { tasks: { where: { archived: false } }, boards: true } },
      },
    });
    return NextResponse.json({ projects, orgId: ctx.orgId });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    await requireWorkspace(input.workspaceId, ["ADMIN", "MEMBER"]);
    const project = await db.project.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description ?? null,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        status: "PLANNING",
      },
      select: { id: true, name: true, status: true },
    });
    await audit("project.created", { target: project.id, meta: { name: project.name } });
    return NextResponse.json({ project }, { status: 201 });
  });
}
