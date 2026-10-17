import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import {
  deleteDepartment,
  getDepartment,
  updateDepartment,
  updateDepartmentSchema,
} from "@/server/services/departments";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await getDepartment(ctx.orgId, params.id));
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(updateDepartmentSchema, req);
    const ctx = await activeOrgCtx();
    await updateDepartment(ctx, params.id, input);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await deleteDepartment(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
