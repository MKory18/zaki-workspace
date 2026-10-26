import { createReadStream, promises as fs } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { db } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { logEvent } from "@/server/services/integrations";
import { canReadConversation } from "@/server/policy/conversation";
import { MAX_FILE_BYTES, canManageFile, checksumHex, safeStoredName, sniffMimeType } from "@/server/files/sniff";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { libraryOnDrive } from "@/server/services/google";
import {
  DriveStoreError,
  type DriveSpace,
  driveIdOf,
  driveNameFor,
  isDrivePath,
  moveToOldVersions,
  readAllFromDrive,
  readFromDrive,
  trashOnDrive,
  uploadToDrive,
} from "@/server/files/drive-store";

export const fileLibrary = process.env.UPLOAD_DIR || join(process.cwd(), ".data", "uploads");

/**
 * `path` of a row whose bytes are not on disk (yet): `ingest` creates the row first - it needs the
 * id for the file name - and writes the bytes second. Such a row is never a file: it is not listed,
 * not counted as a version and not served. Anything that reads `StoredFile` directly must skip it
 * too (`where: { path: { not: PENDING_PATH } }`).
 */
export const PENDING_PATH = "pending";
const STORED = { path: { not: PENDING_PATH } } as const;

export const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm", "audio/mpeg", "audio/wav", "audio/ogg", "application/pdf"]);
export const INLINE_TEXT = new Set(["text/plain", "application/zip"]);

export async function logFile(orgId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
  await logEvent(orgId, { direction: "IN", type, payload: payload as Prisma.InputJsonValue });
}

/* ---------------- where a library file is read ---------------- */

/**
 * EACH SPACE HAS ITS OWN LIBRARY (the owner's decision, 2026-10-25): inside a space, the files uploaded there; inside
 * «الشركة» also the files from before spaces had libraries.
 */
export interface FilePlace {
  spaceId: string | null;
  isHq: boolean;
}

export function filePlaceWhere(place: FilePlace): Prisma.StoredFileWhereInput {
  if (!place.spaceId) return { id: { in: [] } };
  return place.isHq ? { OR: [{ workspaceId: place.spaceId }, { workspaceId: null }] } : { workspaceId: place.spaceId };
}

/** A library file of a space the person cannot open is «not found» (one with no space is everybody's). */
async function assertOfMySpaces(userId: string, workspaceId: string | null): Promise<void> {
  if (workspaceId && !(await accessibleWorkspaceIds(userId)).includes(workspaceId)) throw new NotFoundError("files.not_found");
}

/* ---------------- reads ---------------- */

/** The library files of the place whose name carries the words (the search box; newest first). */
export async function searchLibrary(orgId: string, place: FilePlace, q: string): Promise<Array<{ id: string; name: string }>> {
  return db.storedFile.findMany({
    where: {
      orgId,
      isLatest: true,
      deletedAt: null,
      purpose: "LIBRARY",
      ...STORED,
      AND: [filePlaceWhere(place)],
      name: { contains: q, mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { id: true, name: true },
  });
}

export async function listFiles(orgId: string, place?: FilePlace): Promise<
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
  const here = place ? { AND: [filePlaceWhere(place)] } : {};
  const heads = await db.storedFile.findMany({
    where: { orgId, isLatest: true, deletedAt: null, purpose: "LIBRARY", ...STORED, ...here },
    orderBy: { createdAt: "desc" },
    include: { uploader: { select: { name: true } } },
  });
  const counts = await db.storedFile.groupBy({
    by: ["familyId"],
    where: { orgId, ...STORED, purpose: "LIBRARY", ...here },
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

/**
 * The gate of the library routes (meta and bytes) for one stored file. A LIBRARY file is open to
 * the caller (the route has already refused guests). A CHAT/VOICE file is not a library file: it
 * opens only for someone who may read the conversation of a message it is attached to (the
 * OWNER silently; the file of a deleted message for the OWNER only), or for its uploader while no
 * message has claimed it yet - the same rule as /api/chat/attachments/[id]. Anything else is
 * 404, never 403, so a file id from another conversation says nothing.
 */
export async function assertMayReadFile(ctx: OrgAccessContext, id: string): Promise<void> {
  const f = await db.storedFile.findFirst({
    where: { id, orgId: ctx.orgId, deletedAt: null, ...STORED },
    select: {
      purpose: true,
      uploaderId: true,
      workspaceId: true,
      chatLinks: { select: { message: { select: { conversationId: true, deletedAt: true } } } },
    },
  });
  if (!f) throw new NotFoundError("files.not_found");
  // a library file: of one of the person's spaces (or from before spaces had libraries)
  if (f.purpose === "LIBRARY") return assertOfMySpaces(ctx.userId, f.workspaceId);
  const messages = f.chatLinks.flatMap((l) => (l.message ? [l.message] : []));
  if (messages.length === 0 && f.uploaderId === ctx.userId) return;
  for (const m of messages) {
    if (m.deletedAt && ctx.orgRole !== "OWNER") continue;
    if (await canReadConversation(ctx.userId, m.conversationId)) return;
  }
  throw new NotFoundError("files.not_found");
}

/** Meta of the family of a file the caller may read (`assertMayReadFile` first). */
export async function getFileMeta(orgId: string, id: string) {
  const anchor = await db.storedFile.findFirst({
    where: { id, orgId, deletedAt: null, ...STORED },
    select: { familyId: true, isLatest: true },
  });
  if (!anchor) throw new NotFoundError("files.not_found");
  // meta always describes the family HEAD, whoever asked
  const head = anchor.isLatest
    ? await db.storedFile.findFirst({
        where: { id, orgId, deletedAt: null, ...STORED },
        include: { uploader: { select: { name: true } } },
      })
    : await db.storedFile.findFirst({
        where: { familyId: anchor.familyId, isLatest: true, deletedAt: null, ...STORED },
        include: { uploader: { select: { name: true } } },
      });
  if (!head) throw new NotFoundError("files.not_found");
  const versions = await db.storedFile.findMany({
    where: { familyId: head.familyId, ...STORED },
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

/**
 * Raw bytes for the proxy/download endpoints. Permission gate is in the caller: `assertMayReadFile`
 * for the library route, the conversation rule for the chat attachment route.
 */
export async function readStored(orgId: string, id: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const f = await db.storedFile.findFirst({ where: { id, orgId, deletedAt: null, ...STORED } });
  if (!f) throw new NotFoundError("files.not_found");
  let buffer: Buffer;
  try {
    buffer = isDrivePath(f.path) ? await readAllFromDrive(orgId, driveIdOf(f.path)) : await fs.readFile(join(fileLibrary, f.path));
  } catch (err) {
    throw driveReadError(err);
  }
  return { buffer, mimeType: f.mimeType, name: f.name };
}

/** Drive gone for a moment is not «the file is gone». */
function driveReadError(err: unknown): NotFoundError {
  if (err instanceof DriveStoreError && err.status !== 404) return new NotFoundError("files.drive_unavailable");
  return new NotFoundError("files.missing_storage");
}

/**
 * A stored file opened for streaming (the download route): its size, and its bytes - all of them or
 * one inclusive range - read on demand from the server's disk or from Drive. Nothing is held in memory.
 * Permission gate is in the caller, as for `readStored`.
 */
export async function openStored(
  orgId: string,
  id: string,
): Promise<{ mimeType: string; name: string; size: number; stream: (range: { start: number; end: number } | null) => Promise<ReadableStream<Uint8Array>> }> {
  const f = await db.storedFile.findFirst({ where: { id, orgId, deletedAt: null, ...STORED }, select: { path: true, mimeType: true, name: true, size: true } });
  if (!f) throw new NotFoundError("files.not_found");
  if (isDrivePath(f.path)) {
    const driveId = driveIdOf(f.path);
    return {
      mimeType: f.mimeType,
      name: f.name,
      // the upload checked that Drive holds exactly `size` bytes
      size: f.size,
      stream: (range) => readFromDrive(orgId, driveId, range).catch((err: unknown) => Promise.reject(driveReadError(err))),
    };
  }
  const full = join(fileLibrary, f.path);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat?.isFile()) throw new NotFoundError("files.missing_storage");
  return {
    mimeType: f.mimeType,
    name: f.name,
    size: stat.size,
    stream: async (range) =>
      Readable.toWeb(createReadStream(full, range ? { start: range.start, end: range.end } : {})) as unknown as ReadableStream<Uint8Array>,
  };
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
  purpose: "LIBRARY" | "CHAT" | "VOICE" = "LIBRARY",
  meta?: Record<string, unknown>,
  /**
   * `sniffedMime`: the chat's own sniffing (`sniffChatMedia`) already read the bytes WITH the declared
   * kind, which is the only way to tell audio/webm from video/webm; the plain sniffer here would
   * store a voice note as a video. Trusted callers only, never a client's claim.
   */
  opts: { sniffedMime?: string; workspaceId?: string | null } = {},
): Promise<{ id: string; version: number; mimeType: string }> {
  // a guest posts in the topics of their spaces (files and voice notes included), never in the library
  if (ctx.orgRole === "GUEST" && purpose === "LIBRARY") throw new ForbiddenError("chat.guest_forbidden");
  if (input.bytes.length === 0) throw new ForbiddenError("files.empty");
  if (input.bytes.length > MAX_FILE_BYTES) throw new ForbiddenError("files.too_large");

  const mime = opts.sniffedMime ?? sniffMimeType(input.bytes);
  if (!mime) throw new ForbiddenError("files.unsupported");

  const display = safeStoredName(input.name.split(/[\\/]/).pop() ?? "file");
  const familyId = familyOf ? familyOf.familyId : "";
  const version = familyOf ? familyOf.latestVersion + 1 : 1;
  // a library file lives in a space: a new version in its family's, a new file in the one it was uploaded in
  const workspaceId =
    purpose !== "LIBRARY"
      ? null
      : familyOf
        ? ((await db.storedFile.findFirst({ where: { familyId, orgId: ctx.orgId }, select: { workspaceId: true } }))?.workspaceId ?? null)
        : (opts.workspaceId ?? null);

  // The row comes first (its id is part of the file name) and is PENDING until the bytes are on disk.
  const created = await db.storedFile.create({
    data: {
      orgId: ctx.orgId,
      uploaderId: ctx.userId,
      familyId,
      name: display,
      path: PENDING_PATH,
      mimeType: mime,
      size: input.bytes.length,
      version,
      purpose,
      workspaceId,
    },
    select: { id: true },
  });
  if (meta && Object.keys(meta).length > 0) {
    // Parameterised raw SQL until the generated client knows the column
    // (migration 20261024093000_stored_file_meta; the coordinator regenerates between waves).
    await db.$executeRaw`UPDATE "StoredFile" SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${created.id}`;
  }

  const finalFamilyId = familyId || created.id;
  // A library file goes to the owner's Drive when it is connected for it; on any Drive failure it is
  // kept on the server exactly as before, so an upload never fails because of Drive.
  const space = purpose === "LIBRARY" && (await libraryOnDrive(ctx.orgId)) ? { of: await driveSpaceOf(workspaceId) } : null;
  const steppingDown = space && familyOf ? await previousHeadPath(ctx.orgId, finalFamilyId) : null;
  let path = "";
  let target: string | null = null;
  let updated: { id: string; version: number; mimeType: string };
  try {
    if (space) {
      path = await uploadToDrive(ctx.orgId, { name: driveNameFor(display, version), mimeType: mime, bytes: input.bytes, space: space.of, fileId: created.id }).catch(
        async (err: unknown) => {
          await logEvent(ctx.orgId, { direction: "OUT", type: "file.drive_failed", status: "FAILED", detail: err instanceof DriveStoreError ? err.message : "drive.error" });
          return "";
        },
      );
    }
    if (!path) {
      path = join(ctx.orgId, `${created.id}_v${version}_${display}`);
      target = join(fileLibrary, path);
      await fs.mkdir(join(fileLibrary, ctx.orgId), { recursive: true });
      await fs.writeFile(target, input.bytes);
    }
    // The row becomes a file, and the previous head steps down, in ONE transaction.
    updated = await db.$transaction(async (tx) => {
      const row = await tx.storedFile.update({
        where: { id: created.id },
        data: { path, familyId: finalFamilyId },
        select: { id: true, version: true, mimeType: true },
      });
      if (familyOf) {
        await tx.storedFile.updateMany({
          where: { familyId: finalFamilyId, isLatest: true, id: { not: created.id } },
          data: { isLatest: false },
        });
      }
      return row;
    });
  } catch (err) {
    // Leave nothing behind. A row without its bytes is listed, then answers 404 on download
    // (a root-owned volume makes EVERY upload end up here).
    if (target) await fs.rm(target, { force: true }).catch(() => undefined);
    if (isDrivePath(path)) await trashOnDrive(ctx.orgId, driveIdOf(path)).catch(() => undefined);
    await db.storedFile.deleteMany({ where: { id: created.id } }).catch(() => undefined);
    throw err;
  }
  // the version that stepped down leaves the space folder for «نسخ قديمة» (tidiness only: never fails the upload)
  if (space && steppingDown && isDrivePath(steppingDown)) {
    await moveToOldVersions(ctx.orgId, driveIdOf(steppingDown), space.of).catch(() => undefined);
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

/** The Drive folder of a library file's space (none: a file from before spaces had libraries). */
async function driveSpaceOf(workspaceId: string | null): Promise<DriveSpace | null> {
  if (!workspaceId) return null;
  return db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
}

async function previousHeadPath(orgId: string, familyId: string): Promise<string | null> {
  const head = await db.storedFile.findFirst({ where: { orgId, familyId, isLatest: true, deletedAt: null, ...STORED }, select: { path: true } });
  return head?.path ?? null;
}

/** Library files only: a chat file goes with its message, never through the library. */
export async function softDelete(ctx: OrgAccessContext, id: string): Promise<void> {
  const f = await db.storedFile.findFirst({
    where: { id, orgId: ctx.orgId, deletedAt: null, purpose: "LIBRARY", ...STORED },
    select: { id: true, uploaderId: true, isLatest: true, familyId: true, workspaceId: true },
  });
  if (!f) throw new NotFoundError("files.not_found");
  await assertOfMySpaces(ctx.userId, f.workspaceId);
  if (!canManageFile({ uploaderId: f.uploaderId, viewerId: ctx.userId, orgRole: ctx.orgRole })) {
    throw new ForbiddenError("files.no_perm");
  }
  await db.$transaction(async (tx) => {
    await tx.storedFile.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
    if (f.isLatest) {
      // a head was removed → promote the newest surviving version as the new head
      const heir = await tx.storedFile.findFirst({
        where: { familyId: f.familyId, deletedAt: null, ...STORED },
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
