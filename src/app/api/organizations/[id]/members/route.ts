import { NextResponse } from "next/server";
import { requireOrgRole } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { addMemberSchema, addOrgMember, listOrgMembers } from "@/server/services/org-members";

/** GET: members roster — OWNER/ADMIN manage view. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireOrgRole(params.id, ["OWNER", "ADMIN"]);
    const members = await listOrgMembers(ctx.orgId);
    return NextResponse.json({ members, actorRole: ctx.orgRole });
  });
}

/** POST: admin directly creates an employee account with a role (no join code needed). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(addMemberSchema, req);
    const ctx = await requireOrgRole(params.id, ["OWNER", "ADMIN"]);
    const created = await addOrgMember(ctx, input);
    return NextResponse.json({ ...created }, { status: 201 });
  });
}
