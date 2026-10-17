import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { activeOrgCtx, assertOrgManager } from "@/server/services/integrations";
import { disconnectGoogle, getGoogleStatus, listDriveFiles, type DriveFile } from "@/server/services/google";

const querySchema = z.object({
  files: z.coerce.boolean().optional(),
});

/** GET: connection status; `?files=1` appends read-only Drive file list. */
export async function GET(req: Request) {
  return withApi(async () => {
    const url = new URL(req.url);
    const q = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const ctx = await activeOrgCtx();
    const state = await getGoogleStatus(ctx.orgId);
    let files: DriveFile[] = [];
    let filesError: string | null = null;
    if (q.files && state.connected) {
      const res = await listDriveFiles(ctx.orgId);
      if (res.ok) {
        files = res.files;
      } else {
        filesError = res.error;
      }
    }
    return NextResponse.json({ ...state, files, filesError });
  });
}

/** DELETE: disconnect (drops stored tokens). */
export async function DELETE() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertOrgManager(ctx.orgId);
    await disconnectGoogle(ctx.orgId);
    return NextResponse.json({ ok: true });
  });
}
