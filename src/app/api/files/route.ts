import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertMemberCan } from "@/server/policy/actor";
import { assertNotGuest } from "@/server/services/guest-guard";
import { ingest, listFiles } from "@/server/services/files";
import { BodyTooLargeError, readFormDataLimited } from "@/server/http/body-limit";
import { MAX_FILE_BYTES } from "@/server/files/sniff";
import { currentSpace } from "@/server/services/current-space";
import { libraryOnDrive } from "@/server/services/google";

/** One upload's form: the biggest file the library takes, plus the multipart envelope. */
const MAX_FORM_BYTES = MAX_FILE_BYTES + 1024 * 1024;

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
    let form: FormData;
    try {
      form = await readFormDataLimited(req, MAX_FORM_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) return NextResponse.json({ error: "bad_request", message: "files.too_large" }, { status: 413 });
      throw err;
    }
    const entry = form.get("file");
    if (!(entry instanceof File)) return NextResponse.json({ error: "bad_request", message: "files.empty" }, { status: 400 });
    const bytes = new Uint8Array(await entry.arrayBuffer());
    // the library of the space the person is in
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const made = await ingest(ctx, { name: entry.name, bytes }, undefined, "LIBRARY", undefined, { workspaceId: space?.id ?? null });
    return NextResponse.json(made, { status: 201 });
  });
}

/** GET: the library of the space the person is in — heads only (latest version of every family); `onDrive`: new files go to Drive. */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    // the library row of the person's grid («يشوف»); uploading is checked by `ingest` («يضيف ويعدّل»)
    await assertMemberCan(ctx, "files.view", "section.view_denied");
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const [files, onDrive] = await Promise.all([listFiles(ctx.orgId, { spaceId: space?.id ?? null, isHq: space?.kind === "HQ" }), libraryOnDrive(ctx.orgId)]);
    return NextResponse.json({ files, onDrive });
  });
}
