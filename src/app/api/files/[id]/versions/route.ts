import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertMayReadFile, ingest, PENDING_PATH } from "@/server/services/files";
import { BodyTooLargeError, readFormDataLimited } from "@/server/http/body-limit";
import { MAX_FILE_BYTES } from "@/server/files/sniff";

/** One version's form: the biggest file the library takes, plus the multipart envelope. */
const MAX_FORM_BYTES = MAX_FILE_BYTES + 1024 * 1024;

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

    let form: FormData;
    try {
      form = await readFormDataLimited(req, MAX_FORM_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return NextResponse.json({ error: "bad_request", message: "files.too_large" }, { status: 413 });
      }
      throw err;
    }
    const entry = form.get("file");
    if (!(entry instanceof File)) {
      return NextResponse.json({ error: "bad_request", message: "files.empty" }, { status: 400 });
    }
    const bytes = new Uint8Array(await entry.arrayBuffer());
    const made = await ingest(ctx, { name: entry.name, bytes }, {
      familyId: head.familyId,
      latestVersion: head.version,
    });
    return NextResponse.json(made, { status: 201 });
  });
}
