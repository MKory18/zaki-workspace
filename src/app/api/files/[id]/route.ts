import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertMayReadFile, getFileMeta, softDelete } from "@/server/services/files";

/** GET: one file's metadata + its version list (org members; never guests; a chat file only for its conversation's readers). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertMayReadFile(ctx, params.id);
    return NextResponse.json(await getFileMeta(ctx.orgId, params.id));
  });
}

/** DELETE: soft-delete one version of a LIBRARY file (uploader or org OWNER/ADMIN service check; never guests). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await softDelete(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
