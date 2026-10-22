import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import {
  createDepartment,
  createDepartmentSchema,
  listDepartments,
} from "@/server/services/departments";

/** GET: the departments with their members (a staff directory, so guests get 403 from the service). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json({ departments: await listDepartments(ctx) });
  });
}

/** POST: create a department (OWNER/ADMIN; guests get 403 from the service). */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(createDepartmentSchema, req);
    const dept = await createDepartment(ctx, input);
    return NextResponse.json(dept, { status: 201 });
  });
}
