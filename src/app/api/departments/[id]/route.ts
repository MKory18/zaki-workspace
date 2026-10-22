import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { directoryContext } from "@/app/api/_access";
import {
  deleteDepartment,
  getDepartment,
  updateDepartment,
  updateDepartmentSchema,
} from "@/server/services/departments";

/** GET: one department with its members and projects (`directory.view`; guests get 403 `guest.no_access`). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await directoryContext();
    return NextResponse.json(await getDepartment(ctx, params.id));
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(updateDepartmentSchema, req);
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
