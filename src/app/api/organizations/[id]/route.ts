import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { NotFoundError, audit, requireOrgMember, requireOrgRole } from "@/server/auth";
import { db } from "@/server/db";

const renameSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

/** GET: org summary for settings (any ACTIVE member, whatever their rank; joinCode intentionally omitted). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    await requireOrgMember(params.id);
    const org = await db.organization.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, createdAt: true },
    });
    if (!org) throw new NotFoundError("organization.not_found");
    return NextResponse.json({ org });
  });
}

/** PATCH: rename the organization (OWNER only, audit-logged). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(renameSchema, req);
    const ctx = await requireOrgRole(params.id, ["OWNER"]);
    const org = await db.organization.update({
      where: { id: params.id },
      data: { name: input.name },
      select: { id: true, name: true },
    });
    await audit("org.renamed", { actorId: ctx.userId, orgId: params.id, target: org.id });
    return NextResponse.json({ org });
  });
}
