import { z } from "zod";
import { NotFoundError, ValidationError } from "@/server/auth";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { PENDING_PATH } from "@/server/services/files";
import { assertCardFile, assertWrite, loadCard, type CardRow, type CardScope } from "@/server/services/cards";
import { recordCard } from "@/server/services/card-audit";
import { LIMITS } from "@/lib/cards/shared";
import type { GalleryItem } from "@/lib/cards/page";

/**
 * «المعرض»: a cover picture and an ordered gallery of pictures and files, with captions. The bytes are the existing
 * file library's (`StoredFile`: uploaded through the one upload route, sniffed and limited there); a card only LINKS to a
 * file, and only to one the editor may use: a finished, current library file of THIS space, which needs the library's
 * «يشوف». Nobody without the library (an external partner included) is shown the gallery.
 */

export const IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export const attachSchema = z.object({
  fileId: z.string().min(1).max(64),
  caption: z.string().trim().max(LIMITS.caption).nullable().optional(),
});
export const captionSchema = z.object({ caption: z.string().trim().max(LIMITS.caption).nullable() });
export const orderSchema = z.object({ ids: z.array(z.string().min(1).max(64)).max(LIMITS.attachments) });
export const coverSchema = z.object({ fileId: z.string().min(1).max(64).nullable() });

const cleanCaption = (c: string | null | undefined): string | null => (c && c.trim() ? c.trim() : null);

/** The gallery the viewer is shown: empty for anybody without the library. Dead or unfinished files are left out. */
export async function galleryOf(scope: CardScope, row: Pick<CardRow, "id" | "coverFileId">): Promise<GalleryItem[]> {
  if (!scope.seesFiles) return [];
  const rows = await db.cardAttachment.findMany({
    where: { cardId: row.id, file: { deletedAt: null, path: { not: PENDING_PATH } } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, fileId: true, position: true, caption: true, file: { select: { name: true, mimeType: true, size: true } } },
  });
  return rows.map((r) => ({ id: r.id, fileId: r.fileId, position: r.position, caption: r.caption, isCover: r.fileId === row.coverFileId, file: r.file }));
}

export async function listGallery(actor: Actor, cardId: string): Promise<GalleryItem[]> {
  const { scope, row } = await loadCard(actor, cardId);
  return galleryOf(scope, row);
}

async function writable(actor: Actor, cardId: string) {
  const loaded = await loadCard(actor, cardId);
  assertWrite(loaded.scope);
  // a deleted card is the owner's to read; nothing is added to it
  if (loaded.row.archivedAt) throw new NotFoundError("cards.not_found");
  return loaded;
}

async function nameOf(fileId: string): Promise<string | null> {
  return (await db.storedFile.findUnique({ where: { id: fileId }, select: { name: true } }))?.name ?? null;
}

export async function addAttachment(actor: Actor, cardId: string, input: z.infer<typeof attachSchema>): Promise<GalleryItem[]> {
  const { scope, row } = await writable(actor, cardId);
  await assertCardFile(scope, input.fileId);
  const existing = await db.cardAttachment.findMany({ where: { cardId: row.id }, select: { fileId: true, position: true } });
  if (existing.length >= LIMITS.attachments) throw new ValidationError([{ path: "fileId", message: "cards.e.attach_limit" }]);
  if (existing.some((a) => a.fileId === input.fileId)) throw new ValidationError([{ path: "fileId", message: "cards.e.attach_dup" }]);
  await db.cardAttachment.create({
    data: {
      cardId: row.id,
      fileId: input.fileId,
      caption: cleanCaption(input.caption),
      position: existing.reduce((m, a) => Math.max(m, a.position), -1) + 1,
      addedById: actor.userId,
    },
  });
  await recordCard(actor, row, "image_added", { name: (await nameOf(input.fileId)) ?? "" });
  return galleryOf(scope, row);
}

async function attachmentOf(cardId: string, attachmentId: string) {
  const found = await db.cardAttachment.findFirst({ where: { id: attachmentId, cardId }, select: { id: true, fileId: true } });
  if (!found) throw new NotFoundError("cards.attachment_not_found");
  return found;
}

export async function setCaption(actor: Actor, cardId: string, attachmentId: string, caption: string | null): Promise<GalleryItem[]> {
  const { scope, row } = await writable(actor, cardId);
  const found = await attachmentOf(row.id, attachmentId);
  await db.cardAttachment.update({ where: { id: found.id }, data: { caption: cleanCaption(caption) } });
  return galleryOf(scope, row);
}

/** Takes the picture out of the gallery (the file itself stays in the library). */
export async function removeAttachment(actor: Actor, cardId: string, attachmentId: string): Promise<GalleryItem[]> {
  const { scope, row } = await writable(actor, cardId);
  const found = await attachmentOf(row.id, attachmentId);
  const name = await nameOf(found.fileId);
  await db.cardAttachment.delete({ where: { id: found.id } });
  await recordCard(actor, row, "image_removed", { name: name ?? "" });
  return galleryOf(scope, row);
}

/** The new order: exactly the card's attachments, each once. */
export async function reorderAttachments(actor: Actor, cardId: string, ids: string[]): Promise<GalleryItem[]> {
  const { scope, row } = await writable(actor, cardId);
  const current = await db.cardAttachment.findMany({ where: { cardId: row.id }, select: { id: true } });
  const same = ids.length === current.length && new Set(ids).size === ids.length && ids.every((id) => current.some((c) => c.id === id));
  if (!same) throw new ValidationError([{ path: "ids", message: "cards.e.attach_order" }]);
  await db.$transaction(ids.map((id, position) => db.cardAttachment.update({ where: { id }, data: { position } })));
  return galleryOf(scope, row);
}

/** The cover: a picture from the library of this space (null: no cover). */
export async function setCover(actor: Actor, cardId: string, fileId: string | null): Promise<{ coverFileId: string | null }> {
  const { scope, row } = await writable(actor, cardId);
  if (fileId) {
    await assertCardFile(scope, fileId);
    const file = await db.storedFile.findUnique({ where: { id: fileId }, select: { mimeType: true, name: true } });
    if (!file || !IMAGE_TYPES.has(file.mimeType)) throw new ValidationError([{ path: "fileId", message: "cards.e.cover_image" }]);
  }
  if (fileId !== row.coverFileId) {
    await db.card.update({ where: { id: row.id }, data: { coverFileId: fileId } });
    await recordCard(actor, row, "cover", { name: fileId ? ((await nameOf(fileId)) ?? "") : "", removed: fileId === null });
  }
  return { coverFileId: fileId };
}
