import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { softDelete } from "@/server/services/files";

/** DELETE: soft-delete one version (uploader or org OWNER/ADMIN service check). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await softDelete(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
