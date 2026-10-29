import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ForbiddenError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { clearAvatar, setAvatar, AVATAR_MAX_BYTES } from "@/server/services/avatars";
import { parseMultipartUpload } from "@/server/files/multipart";
import { uploadTempDir, UploadStreamError } from "@/server/files/upload-stream";

/**
 * My own picture.
 *
 *  POST   multipart `file` — the bytes are sniffed (PNG, JPEG or WebP, at most 2 MB); the answer is
 *         `{ avatarUrl }`, and the previous picture is soft-deleted.
 *  DELETE — back to the initials.
 *
 * A GUEST is refused (`guest.no_access`), as everywhere the staff directory is closed.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    let received: Awaited<ReturnType<typeof parseMultipartUpload>>["upload"] | undefined;
    try {
      ({ upload: received } = await parseMultipartUpload(req, {
        fieldName: "file",
        maxBytes: AVATAR_MAX_BYTES,
        tempDir: uploadTempDir,
      }));
      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(received.path);
      const made = await setAvatar(
        { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId },
        { name: received.name, bytes: new Uint8Array(bytes) },
      );
      return NextResponse.json(made, { status: 201 });
    } catch (err) {
      if (err instanceof UploadStreamError && (err.kind === "empty" || err.kind === "invalid")) {
        return NextResponse.json({ error: "bad_request", message: "avatar.empty" }, { status: 400 });
      }
      if (err instanceof UploadStreamError && err.kind === "too_large") throw new ForbiddenError("avatar.too_large");
      throw err;
    } finally {
      await received?.cleanup();
    }
  });
}

export async function DELETE() {
  return withApi(async () => {
    const actor = await requireActor();
    if (actor.role === "GUEST") throw new ForbiddenError("guest.no_access");
    await clearAvatar({ orgId: actor.orgId, userId: actor.userId });
    return NextResponse.json({ ok: true });
  });
}
