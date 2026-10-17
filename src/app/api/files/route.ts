import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { ingest, listFiles } from "@/server/services/files";

/**
 * POST multipart/form-data: file=<binary> — bytes are sniffed server-side;
 * the client's claimed type is ignored entirely (magic bytes only).
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const form = await req.formData();
    const entry = form.get("file");
    if (!(entry instanceof File)) return NextResponse.json({ error: "bad_request", message: "files.empty" }, { status: 400 });
    const bytes = new Uint8Array(await entry.arrayBuffer());
    const made = await ingest(ctx, { name: entry.name, bytes });
    return NextResponse.json(made, { status: 201 });
  });
}

/** GET: the library — heads only (latest version of every family). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json({ files: await listFiles(ctx.orgId) });
  });
}
