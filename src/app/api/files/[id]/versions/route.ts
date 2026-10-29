import { NextResponse } from "next/server";
import { NotFoundError } from "@/server/auth";
import { parseMultipartUpload } from "@/server/files/multipart";
import { uploadTempDir, UploadStreamError } from "@/server/files/upload-stream";
import { MAX_FILE_BYTES } from "@/server/files/sniff";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertMayReadFile, ingest, PENDING_PATH } from "@/server/services/files";

/** POST multipart/form-data: file= — stores a NEW VERSION in the same family of a LIBRARY file (never for guests). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    // any surviving member of the family identifies it; a chat file is never a library family
    const anchor = await db.storedFile.findFirst({
      where: { id: params.id, orgId: ctx.orgId, deletedAt: null, purpose: "LIBRARY", path: { not: PENDING_PATH } },
      select: { familyId: true },
    });
    if (!anchor) throw new NotFoundError("files.not_found");
    // a file of a space the person cannot open is «not found» here too
    await assertMayReadFile(ctx, params.id);
    const head = await db.storedFile.findFirst({
      where: { familyId: anchor.familyId, isLatest: true, deletedAt: null, path: { not: PENDING_PATH } },
      select: { familyId: true, version: true },
    });
    if (!head) throw new NotFoundError("files.not_found");

    let received;
    try {
      ({ upload: received } = await parseMultipartUpload(req, { fieldName: "file", maxBytes: MAX_FILE_BYTES, tempDir: uploadTempDir }));
      const made = await ingest(ctx, { name: received.name, path: received.path, size: received.size, prefix: received.prefix }, {
        familyId: head.familyId,
        latestVersion: head.version,
      });
      return NextResponse.json(made, { status: 201 });
    } catch (err) {
      if (err instanceof UploadStreamError && (err.kind === "empty" || err.kind === "invalid")) {
        return NextResponse.json({ error: "bad_request", message: err.message }, { status: 400 });
      }
      // a body over the ceiling is answered 413 before its bytes are buffered (security review D2)
      if (err instanceof UploadStreamError && err.kind === "too_large") return NextResponse.json({ error: "payload_too_large", message: "files.too_large" }, { status: 413 });
      throw err;
    } finally {
      await received?.cleanup();
    }
  });
}
