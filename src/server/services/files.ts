import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { db } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { logEvent } from "@/server/services/integrations";
import { MAX_FILE_BYTES, canManageFile, checksumHex, safeStoredName, sniffMimeType } from "@/server/files/sniff";

export const fileLibrary = process.env.UPLOAD_DIR || join(process.cwd(), ".data", "uploads");

export const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm", "audio/mpeg", "audio/wav", "audio/ogg", "application/pdf"]);
export const INLINE_TEXT = new Set(["text/plain", "application/zip"]);

export async function logFile(orgId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
  await logEvent(orgId, { direction: "IN", type, payload: payload as Prisma.InputJsonValue });
}

/* ---------------- reads ---------------- */

export async function listFiles(orgId: string): Promise<
  Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    version: number;
    versions: number;
    previewable: boolean;
    uploader: string;
    uploaderId: string;
    createdAt: Date;
    familyId: string;
  }>
> {
  const heads = await db.storedFile.findMany({
    where: { orgId, isLatest: true, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { uploader: { select: { name: true } } },
  });
  const counts = await db.storedFile.groupBy({
    by: ["familyId"],
    where: { orgId },
    _count: { familyId: true },
  });
  const versionCount = new Map(counts.map((c) => [c.familyId, c._count.familyId]));
  return heads.map((f) => ({
    id: f.id,
    familyId: f.familyId,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    version: f.version,
    versions: versionCount.get(f.familyId) ?? 1,
    previewable: PREVIEWABLE.has(f.mimeType),
    uploader: f.uploader.name,
    uploaderId: f.uploaderId,
    createdAt: f.createdAt,
  }));
}

export async function getFileMeta(orgId: string, id: string) {
  const anchor = await db.storedFile.findFirst({
    where: { id, orgId, deletedAt: null },
    select: { familyId: true, isLatest: true },
  });
  if (!anchor) throw new NotFoundError("files.not_found");
  // meta always describes the family HEAD, whoever asked
  const head = anchor.isLatest
    ? await db.storedFile.findFirst({
        where: { id, orgId, deletedAt: null },
        include: { uploader: { select: { name: true } } },
      })
    : await db.storedFile.findFirst({
        where: { familyId: anchor.familyId, isLatest: true, deletedAt: null },
        include: { uploader: { select: { name: true } } },
      });
  if (!head) throw new NotFoundError("files.not_found");
  const versions = await db.storedFile.findMany({
    where: { familyId: head.familyId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, size: true, createdAt: true, uploader: { select: { name: true } } },
  });
  return {
    id: head.id,
    name: head.name,
    mimeType: head.mimeType,
    size: head.size,
    version: head.version,
    versions: versions.map((v) => ({ id: v.id, version: v.version, size: v.size, createdAt: v.createdAt, uploader: v.uploader.name })),
    previewable: PREVIEWABLE.has(head.mimeType),
    textLike: INLINE_TEXT.has(head.mimeType),
    uploader: head.uploader.name,
    uploaderId: head.uploaderId,
    createdAt: head.createdAt,
  };
}

/** Raw bytes for the proxy/download endpoints. Permission gate is in the route. */
export async function readStored(orgId: string, id: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const f = await db.storedFile.findFirst({ where: { id, orgId, deletedAt: null } });
  if (!f) throw new NotFoundError("files.not_found");
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(join(fileLibrary, f.path));
  } catch {
    throw new NotFoundError("files.missing_storage");
  }
  return { buffer, mimeType: f.mimeType, name: f.name };
}

/* ---------------- writes ---------------- */

export interface IngestFile {
  name: string;
  bytes: Uint8Array;
}

/** Validate bytes, write to disk + DB as a new head in a version family. */
export async function ingest(
  ctx: OrgAccessContext,
  input: IngestFile,
  familyOf?: { familyId: string; latestVersion: number },
): Promise<{ id: string; version: number; mimeType: string }> {
  if (ctx.orgRole === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  if (input.bytes.length === 0) throw new ForbiddenError("files.empty");
  if (input.bytes.length > MAX_FILE_BYTES) throw new ForbiddenError("files.too_large");

  const mime = sniffMimeType(input.bytes);
  if (!mime) throw new ForbiddenError("files.unsupported");

  const display = safeStoredName(input.name.split(/[\\/]/).pop() ?? "file");
  const familyId = familyOf ? familyOf.familyId : "";
  const version = familyOf ? familyOf.latestVersion + 1 : 1;

  const created = await db.storedFile.create({
    data: {
      orgId: ctx.orgId,
      uploaderId: ctx.userId,
      familyId,
      name: display,
      path: "pending",
      mimeType: mime,
      size: input.bytes.length,
      version,
    },
    select: { id: true },
  });

  const finalFamilyId = familyId || created.id;
  const path = join(ctx.orgId, `${created.id}_v${version}_${display}`);
  await fs.mkdir(join(fileLibrary, ctx.orgId), { recursive: true });
  await fs.writeFile(join(fileLibrary, path), input.bytes);

  const updated = await db.storedFile.update({
    where: { id: created.id },
    data: { path, familyId: finalFamilyId },
    select: { id: true, version: true, mimeType: true },
  });
  if (familyOf) {
    await db.storedFile.updateMany({
      where: { familyId: finalFamilyId, isLatest: true, id: { not: created.id } },
      data: { isLatest: false },
    });
  }

  await logFile(ctx.orgId, "file.uploaded", {
    fileId: created.id,
    familyId: finalFamilyId,
    version,
    mime,
    size: input.bytes.length,
    checksum: checksumHex(input.bytes),
  });
  return { id: updated.id, version: updated.version, mimeType: updated.mimeType };
}

export async function softDelete(ctx: OrgAccessContext, id: string): Promise<void> {
  const f = await db.storedFile.findFirst({
    where: { id, orgId: ctx.orgId, deletedAt: null },
    select: { id: true, uploaderId: true, isLatest: true, familyId: true },
  });
  if (!f) throw new NotFoundError("files.not_found");
  if (!canManageFile({ uploaderId: f.uploaderId, viewerId: ctx.userId, orgRole: ctx.orgRole })) {
    throw new ForbiddenError("files.no_perm");
  }
  await db.$transaction(async (tx) => {
    await tx.storedFile.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
    if (f.isLatest) {
      // a head was removed → promote the newest surviving version as the new head
      const heir = await tx.storedFile.findFirst({
        where: { familyId: f.familyId, deletedAt: null },
        orderBy: { version: "desc" },
        select: { id: true },
      });
      if (heir) {
        await tx.storedFile.update({ where: { id: heir.id }, data: { isLatest: true } });
      }
    }
  });
  await logFile(ctx.orgId, "file.deleted", { fileId: id });
}
