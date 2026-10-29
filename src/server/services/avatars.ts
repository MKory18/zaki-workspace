import { db } from "@/server/db";
import type { OrgRole } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { ingest, PENDING_PATH, readStored } from "@/server/services/files";
import { sniffMimeType } from "@/server/files/sniff";

/**
 * A PERSON'S PICTURE (the owner's ask, 2026-10-29: «خيار إن المستخدم يحط صورة بروفايل»).
 *
 * The picture is a `StoredFile` with `purpose = "AVATAR"`: the bytes go through the same sniffer and
 * the same storage as every other upload (never the client's claimed type), and the row is the only
 * thing that lives on the person (`User.avatarUrl` holds `/api/avatars/<file id>`). Replacing a
 * picture soft-deletes the old row, so nothing is ever orphaned on disk without a row pointing at it.
 *
 * Only still images: a profile circle cannot play a video, and an animated GIF is refused with them
 * (the first frame would be the whole face).
 *
 * THE PICTURE BELONGS TO THE PERSON, NOT TO A COMPANY. A face is the same face in every company the
 * person works in, so the read asks «is this the picture of somebody I work with?» and never «was it
 * uploaded in my company?». The row keeps the `orgId` it was uploaded in (every `StoredFile` has
 * one), which is why retiring an old picture cannot filter by the current company: it would leave the
 * previous row live forever when the person changed companies in between.
 */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB: the client resizes before it uploads
const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/** `/api/avatars/<id>` for a stored file, or null. Anything else in the column is ignored. */
export function avatarUrlOf(storedFileId: string | null | undefined): string | null {
  return storedFileId ? `/api/avatars/${storedFileId}` : null;
}

/** The file id inside `/api/avatars/<id>`, or null. */
export function avatarFileIdOf(avatarUrl: string | null | undefined): string | null {
  const match = /^\/api\/avatars\/([A-Za-z0-9_-]+)$/.exec(avatarUrl ?? "");
  return match?.[1] ?? null;
}

/**
 * Store a new picture for this person and point their row at it. A GUEST has no picture (the staff
 * directory is not theirs, and their face is not the company's to publish).
 */
export async function setAvatar(
  ctx: { orgId: string; orgRole: OrgRole; userId: string },
  input: { name: string; bytes: Uint8Array },
): Promise<{ avatarUrl: string }> {
  if (ctx.orgRole === "GUEST") throw new ForbiddenError("guest.no_access");
  if (input.bytes.length > AVATAR_MAX_BYTES) throw new ForbiddenError("avatar.too_large");
  const mime = sniffMimeType(input.bytes);
  if (!mime || !AVATAR_MIME.has(mime)) throw new ForbiddenError("avatar.unsupported");

  const previous = avatarFileIdOf(
    (await db.user.findUnique({ where: { id: ctx.userId }, select: { avatarUrl: true } }))?.avatarUrl,
  );

  const made = await ingest(
    ctx,
    { name: input.name, bytes: input.bytes },
    undefined,
    "AVATAR",
    undefined,
    { sniffedMime: mime, maxBytes: AVATAR_MAX_BYTES },
  );
  const avatarUrl = avatarUrlOf(made.id)!;
  await db.user.update({ where: { id: ctx.userId }, data: { avatarUrl } });

  if (previous && previous !== made.id) {
    // by id and uploader only: the old picture may have been uploaded in a company the person has
    // since left, and it must still stop being served
    await db.storedFile
      .updateMany({ where: { id: previous, uploaderId: ctx.userId, deletedAt: null }, data: { deletedAt: new Date() } })
      .catch(() => undefined);
  }
  return { avatarUrl };
}

/** Take the picture away: the person goes back to their initials. */
export async function clearAvatar(ctx: { orgId: string; userId: string }): Promise<void> {
  const current = avatarFileIdOf(
    (await db.user.findUnique({ where: { id: ctx.userId }, select: { avatarUrl: true } }))?.avatarUrl,
  );
  await db.user.update({ where: { id: ctx.userId }, data: { avatarUrl: null } });
  if (current) {
    await db.storedFile
      .updateMany({ where: { id: current, uploaderId: ctx.userId, deletedAt: null }, data: { deletedAt: new Date() } })
      .catch(() => undefined);
  }
}

/**
 * The bytes of one picture. Anybody who works with the person may see their face — a colleague of
 * ANY company they are ACTIVE in, because the face is theirs and not one company's. A GUEST may not
 * (the staff directory is closed to them, and a face is part of it). Anything that is not a picture
 * of somebody the caller works with is 404, never a hint.
 */
export async function readAvatar(
  ctx: { orgId: string; userId: string; orgRole: string },
  fileId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (ctx.orgRole === "GUEST") throw new ForbiddenError("guest.no_access");
  const row = await db.storedFile.findFirst({
    where: { id: fileId, deletedAt: null, purpose: "AVATAR", path: { not: PENDING_PATH } },
    select: { id: true, orgId: true, uploaderId: true },
  });
  if (!row) throw new NotFoundError("files.not_found");
  // the picture of somebody who shares a company with the caller (or the caller's own)
  const shares = await db.organizationMember.findFirst({
    where: {
      userId: row.uploaderId,
      status: "ACTIVE",
      organization: { members: { some: { userId: ctx.userId, status: "ACTIVE" } } },
    },
    select: { userId: true },
  });
  if (!shares) throw new NotFoundError("files.not_found");
  const file = await readStored(row.orgId, row.id);
  return { buffer: file.buffer, mimeType: file.mimeType };
}
