import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parse, parseJson } from "@/server/validation";

/** Org-scoped labels, listed via any workspace the caller can read. */
export async function GET(req: Request) {
  return withApi(async () => {
    const url = new URL(req.url);
    const { workspaceId } = parse(
      z.object({ workspaceId: z.string().min(1) }),
      Object.fromEntries(url.searchParams),
    );
    const ctx = await requireWorkspace(workspaceId);
    const labels = await db.label.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    });
    return NextResponse.json({ labels });
  });
}

const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6b7280"),
});

export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const ctx = await requireWorkspace(input.workspaceId, ["ADMIN", "MEMBER"]);
    const label = await db.label.create({
      data: { orgId: ctx.orgId, name: input.name, color: input.color },
      select: { id: true, name: true, color: true },
    });
    await audit("label.created", { actorId: ctx.userId, orgId: ctx.orgId, target: label.id });
    return NextResponse.json({ label }, { status: 201 });
  });
}
