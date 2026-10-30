import { z } from "zod";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { loadCard } from "@/server/services/cards";
import { assertInternal, assertParticipate } from "@/server/services/card-guards";
import { LIMITS } from "@/lib/cards/shared";
import type { NoteItem, NotesView, NoteVisibility } from "@/lib/cards/page";

/**
 * «الملاحظات» (the card's thread). PUBLIC notes are the space's people talking about the card; PRIVATE notes are the
 * author's own and nobody else's: not the owner, not a moderator (a private note does not exist for anybody else).
 * A deleted note keeps its row. Writing needs a place in the space (the owner reading silently has none).
 */

export const noteSchema = z.object({
  body: z.string().trim().min(1, "cards.e.note").max(LIMITS.note, "cards.e.note"),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
});
export const editNoteSchema = z.object({ body: z.string().trim().min(1, "cards.e.note").max(LIMITS.note, "cards.e.note") });

const NOTE_SELECT = {
  id: true,
  authorId: true,
  body: true,
  visibility: true,
  createdAt: true,
  editedAt: true,
  author: { select: { name: true } },
} as const;

function toNote(row: {
  id: string;
  authorId: string;
  body: string;
  visibility: string;
  createdAt: Date;
  editedAt: Date | null;
  author: { name: string };
}): NoteItem {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.author.name,
    body: row.body,
    visibility: row.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
  };
}

/** The thread the viewer may read: the space's public notes, and their own private ones. */
export async function listNotes(actor: Actor, cardId: string): Promise<NotesView> {
  const { scope, row } = await loadCard(actor, cardId);
  assertInternal(scope);
  const [publicRows, privateRows] = await Promise.all([
    db.cardNote.findMany({
      where: { cardId: row.id, visibility: "PUBLIC", deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
      select: NOTE_SELECT,
    }),
    db.cardNote.findMany({
      where: { cardId: row.id, visibility: "PRIVATE", authorId: actor.userId, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
      select: NOTE_SELECT,
    }),
  ]);
  return { publicNotes: publicRows.map(toNote), privateNotes: privateRows.map(toNote) };
}

export async function addNote(actor: Actor, cardId: string, input: z.infer<typeof noteSchema>): Promise<NoteItem> {
  const { scope, row } = await loadCard(actor, cardId);
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  assertParticipate(scope);
  const created = await db.cardNote.create({
    data: { cardId: row.id, authorId: actor.userId, body: input.body, visibility: input.visibility as NoteVisibility },
    select: NOTE_SELECT,
  });
  return toNote(created);
}

/** A note of this card that is still there. Somebody else's PRIVATE note does not exist (404). */
async function liveNote(actor: Actor, cardId: string, noteId: string) {
  const note = await db.cardNote.findFirst({ where: { id: noteId, cardId, deletedAt: null }, select: { ...NOTE_SELECT } });
  if (!note || (note.visibility === "PRIVATE" && note.authorId !== actor.userId)) throw new NotFoundError("cards.note_not_found");
  return note;
}

/** Only the author changes the words of a note. */
export async function editNote(actor: Actor, cardId: string, noteId: string, body: string): Promise<NoteItem> {
  const { scope, row } = await loadCard(actor, cardId);
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  assertParticipate(scope);
  const note = await liveNote(actor, row.id, noteId);
  if (note.authorId !== actor.userId) throw new ForbiddenError("cards.note_not_yours");
  const updated = await db.cardNote.update({ where: { id: note.id }, data: { body, editedAt: new Date() }, select: NOTE_SELECT });
  return toNote(updated);
}

/** «حذف»: the author deletes their note; a moderator may take down a public one. The row stays (`deletedAt`). */
export async function deleteNote(actor: Actor, cardId: string, noteId: string): Promise<void> {
  const { scope, row } = await loadCard(actor, cardId);
  assertInternal(scope);
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  const note = await liveNote(actor, row.id, noteId);
  const mine = note.authorId === actor.userId;
  const moderates = scope.manager && note.visibility === "PUBLIC";
  if (!mine && !moderates) throw new ForbiddenError("cards.note_not_yours");
  await db.cardNote.update({ where: { id: note.id }, data: { deletedAt: new Date(), deletedById: actor.userId } });
}
