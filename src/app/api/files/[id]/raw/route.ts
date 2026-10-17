import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { readStored } from "@/server/services/files";

/** ?download=1 → attachment; otherwise inline (preview) with strict sniffed type. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const { buffer, mimeType, name } = await readStored(ctx.orgId, params.id);
    const wantsDownload = new URL(req.url).searchParams.get("download") === "1";
    const headers: Record<string, string> = {
      "content-type": mimeType,
      "content-length": String(buffer.byteLength),
      "content-disposition": `${wantsDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeIetf(name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=0, must-revalidate",
    };
    return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
  });
}

function encodeIetf(name: string): string {
  return encodeURIComponent(name).replace(/['()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
