import { NextResponse } from "next/server";
import { requireOrgRole } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { memberUpdateSchema, removeOrgMember, updateOrgMember } from "@/server/services/org-members";

/** PATCH: change an employee's role and/or reset their password. OWNER/ADMIN. */
export async function PATCH(req: Request, { params }: { params: { id: string; userId: string } }) {
  return withApi(async () => {
    const input = await parseJson(memberUpdateSchema, req);
    const ctx = await requireOrgRole(params.id, ["OWNER", "ADMIN"]);
    await updateOrgMember(ctx, params.userId, input);
    return NextResponse.json({ ok: true });
  });
}

/** DELETE: remove the employee from the organization (their account survives). */
export async function DELETE(_req: Request, { params }: { params: { id: string; userId: string } }) {
  return withApi(async () => {
    const ctx = await requireOrgRole(params.id, ["OWNER", "ADMIN"]);
    await removeOrgMember(ctx, params.userId);
    return NextResponse.json({ ok: true });
  });
}
