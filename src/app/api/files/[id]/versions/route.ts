import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { ingest, PENDING_PATH } from "@/server/services/files";

/** POST multipart/form-data: file= — stores a NEW VERSION in the same family (never for guests). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    // any surviving member of the family identifies it
    const anchor = await db.storedFile.findFirst({
      where: { id: params.id, orgId: ctx.orgId, deletedAt: null, path: { not: PENDING_PATH } },
      select: { familyId: true },
    });
    if (!anchor) throw new NotFoundError("files.not_found");
    const head = await db.storedFile.findFirst({
      where: { familyId: anchor.familyId, isLatest: true, deletedAt: null, path: { not: PENDING_PATH } },
      select: { familyId: true, version: true },
    });
    if (!head) throw new NotFoundError("files.not_found");

    const form = await req.formData();
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
