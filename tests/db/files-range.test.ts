import { describe, expect, it, vi } from "vitest";

// Keep uploaded test files out of the repo (honoured once files.ts reads UPLOAD_DIR; harmless before).
// vi.hoisted runs before the imports, so it must not use any.
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-${process.pid}`;
});

import * as rawRoute from "@/app/api/files/[id]/raw/route";
import { ingest } from "@/server/services/files";
import { call, loginAs, makeTeam } from "./helpers";

/** A tiny but valid-looking MP4: 'ftyp' at offset 4 is all the sniffer needs. */
function fakeMp4(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  for (let i = 12; i < size; i++) bytes[i] = i % 251;
  return bytes;
}

describe("file download honours Range requests (video seeking)", () => {
  it("answers 206 with Content-Range for a range, 200 with Accept-Ranges otherwise, 416 past the end", async () => {
    const { org, member } = await makeTeam();
    const file = await ingest({ orgId: org.id, orgRole: "MEMBER", userId: member.id }, { name: "clip.mp4", bytes: fakeMp4(1000) });
    await loginAs(member.id);
    const params = { id: file.id };

    const whole = await call(rawRoute.GET, { params });
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-length")).toBe("1000");

    const part = await call(rawRoute.GET, { params, headers: { range: "bytes=100-199" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(part.headers.get("content-length")).toBe("100");

    const tail = await call(rawRoute.GET, { params, headers: { range: "bytes=900-" } });
    expect(tail.status).toBe(206);
    expect(tail.headers.get("content-range")).toBe("bytes 900-999/1000");

    const past = await call(rawRoute.GET, { params, headers: { range: "bytes=5000-" } });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */1000");
  });

  it("another organization cannot read the file, with or without a Range header", async () => {
    const a = await makeTeam();
    const b = await makeTeam();
    const file = await ingest({ orgId: a.org.id, orgRole: "MEMBER", userId: a.member.id }, { name: "clip.mp4", bytes: fakeMp4(200) });
    await loginAs(b.member.id);
    expect((await call(rawRoute.GET, { params: { id: file.id } })).status).toBe(404);
    expect((await call(rawRoute.GET, { params: { id: file.id }, headers: { range: "bytes=0-9" } })).status).toBe(404);
  });
});
