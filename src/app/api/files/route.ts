import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { ingest, listFiles } from "@/server/services/files";
import { currentSpace } from "@/server/services/current-space";

/**
 * The file library is closed to org GUESTs on every route (list, details, bytes, versions,
 * upload, delete): they get 403 `guest.no_access` before anything is read or stored.
 */

/**
 * POST multipart/form-data: file=<binary> — bytes are sniffed server-side;
 * the client's claimed type is ignored entirely (magic bytes only).
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    const form = await req.formData();
    const entry = form.get("file");
    if (!(entry instanceof File)) return NextResponse.json({ error: "bad_request", message: "files.empty" }, { status: 400 });
    const bytes = new Uint8Array(await entry.arrayBuffer());
    // the library of the space the person is in
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const made = await ingest(ctx, { name: entry.name, bytes }, undefined, "LIBRARY", undefined, { workspaceId: space?.id ?? null });
    return NextResponse.json(made, { status: 201 });
  });
}

/** GET: the library of the space the person is in — heads only (latest version of every family). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    return NextResponse.json({ files: await listFiles(ctx.orgId, { spaceId: space?.id ?? null, isHq: space?.kind === "HQ" }) });
  });
}
