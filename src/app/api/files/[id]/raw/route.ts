import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { readStored } from "@/server/services/files";
import { parseByteRange } from "@/server/files/range";

/**
 * ?download=1 → attachment; otherwise inline (preview) with strict sniffed type.
 * Honours a single `Range: bytes=…` request (206) so video/audio can be seeked.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const { buffer, mimeType, name } = await readStored(ctx.orgId, params.id);
    const wantsDownload = new URL(req.url).searchParams.get("download") === "1";
    const base: Record<string, string> = {
      "content-type": mimeType,
      "content-disposition": `${wantsDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeIetf(name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=0, must-revalidate",
      "accept-ranges": "bytes",
    };

    const range = parseByteRange(req.headers.get("range"), buffer.byteLength);
    if (range.kind === "unsatisfiable") {
      return new NextResponse(null, { status: 416, headers: { ...base, "content-range": `bytes */${buffer.byteLength}` } });
    }
    if (range.kind === "partial") {
      const slice = buffer.subarray(range.start, range.end + 1);
      return new NextResponse(new Uint8Array(slice), {
        status: 206,
        headers: {
          ...base,
          "content-length": String(slice.byteLength),
          "content-range": `bytes ${range.start}-${range.end}/${buffer.byteLength}`,
        },
      });
    }
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: { ...base, "content-length": String(buffer.byteLength) },
    });
  });
}

function encodeIetf(name: string): string {
  return encodeURIComponent(name).replace(/['()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
