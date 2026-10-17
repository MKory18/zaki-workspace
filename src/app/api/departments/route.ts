import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import {
  createDepartment,
  createDepartmentSchema,
  listDepartments,
} from "@/server/services/departments";

export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json({ departments: await listDepartments(ctx.orgId) });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createDepartmentSchema, req);
    const ctx = await activeOrgCtx();
    const dept = await createDepartment(ctx, input);
    return NextResponse.json(dept, { status: 201 });
  });
}
