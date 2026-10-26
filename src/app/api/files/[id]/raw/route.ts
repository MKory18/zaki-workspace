import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertMayReadFile, openStored } from "@/server/services/files";
import { parseByteRange } from "@/server/files/range";

/**
 * ?download=1 → attachment; otherwise inline (preview) with strict sniffed type.
 * Honours a single `Range: bytes=…` request (206) so video/audio can be seeked. The bytes are streamed,
 * from the server's disk or proxied from the owner's Drive (only the asked range is fetched): nobody
 * ever gets a Drive link, so the permission check above is the only door.
 * Org GUESTs get 403 `guest.no_access` instead of the bytes. A chat photo or voice note opens
 * here only for the readers of its conversation (`assertMayReadFile`); anyone else gets 404.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertMayReadFile(ctx, params.id);
    const file = await openStored(ctx.orgId, params.id);
    const wantsDownload = new URL(req.url).searchParams.get("download") === "1";
    const base: Record<string, string> = {
      "content-type": file.mimeType,
      "content-disposition": `${wantsDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeIetf(file.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=0, must-revalidate",
      "accept-ranges": "bytes",
    };

    const range = parseByteRange(req.headers.get("range"), file.size);
    if (range.kind === "unsatisfiable") {
      return new NextResponse(null, { status: 416, headers: { ...base, "content-range": `bytes */${file.size}` } });
    }
    if (range.kind === "partial") {
      return new NextResponse(await file.stream(range), {
        status: 206,
        headers: {
          ...base,
          "content-length": String(range.end - range.start + 1),
          "content-range": `bytes ${range.start}-${range.end}/${file.size}`,
        },
      });
    }
    return new NextResponse(await file.stream(null), {
      status: 200,
      headers: { ...base, "content-length": String(file.size) },
    });
  });
}

function encodeIetf(name: string): string {
  return encodeURIComponent(name).replace(/['()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
