import { z } from "zod";
import { NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { PENDING_PATH } from "@/server/services/files";
import { assertWrite, dataOf, loadCard, saveCardEdit } from "@/server/services/cards";
import { loadInternal } from "@/server/services/card-guards";
import { recordCard } from "@/server/services/card-audit";
import type { CardItem, CardKind } from "@/lib/cards/shared";
import type { CardSnapshot } from "@/lib/cards/versions";
import type { RevisionItem, RevisionsView } from "@/lib/cards/page";

/**
 * «الإصدارات»: the snapshots every saved edit left behind (written by `saveCardEdit`, never changed or removed: the
 * table refuses an UPDATE). Restoring an old one is a NEW edit: the current state is appended as a revision and the card
 * moves to the next version with the old content; history is never rewritten.
 */

export const restoreSchema = z.object({ version: z.number().int().min(1).optional() });

const REVISION_LIMIT = 200;

export async function listRevisions(actor: Actor, cardId: string): Promise<RevisionsView> {
  const { row } = await loadInternal(actor, cardId);
  const rows = await db.cardRevision.findMany({
    where: { cardId: row.id },
    orderBy: { version: "desc" },
    take: REVISION_LIMIT,
    select: {
      version: true,
      title: true,
      body: true,
      data: true,
      color: true,
      category: true,
      tags: true,
      fileId: true,
      editorId: true,
      createdAt: true,
      editor: { select: { name: true } },
    },
  });
  const kind = row.kind as CardKind;
  const revisions: RevisionItem[] = rows.map((r) => ({
    version: r.version,
    title: r.title,
    body: r.body,
    data: dataOf(kind, r.data),
    color: r.color,
    category: r.category,
    tags: r.tags,
    fileId: r.fileId,
    editorId: r.editorId,
    editorName: r.editor.name,
    createdAt: r.createdAt.toISOString(),
  }));
  return { currentVersion: row.version, revisions };
}

/**
 * Put the card back to what version `version` was. `baseVersion`: the version the person was looking at (the same 409
 * as an edit when the card has moved on since).
 */
export async function restoreRevision(actor: Actor, cardId: string, version: number, baseVersion?: number): Promise<CardItem> {
  const { scope, row } = await loadCard(actor, cardId);
  assertWrite(scope);
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  const old = await db.cardRevision.findUnique({ where: { cardId_version: { cardId: row.id, version } } });
  if (!old) throw new NotFoundError("cards.revision_not_found");
  const kind = row.kind as CardKind;
  const patch: Partial<CardSnapshot> = {
    title: old.title,
    body: old.body,
    data: dataOf(kind, old.data),
    color: old.color,
    category: old.category,
    tags: old.tags,
  };
  // a file the card used to point at comes back only while it is still a usable file of this space
  if (kind === "FILE" && old.fileId && old.fileId !== row.fileId) {
    const usable = await db.storedFile.findFirst({
      where: { id: old.fileId, orgId: row.orgId, workspaceId: row.workspaceId, deletedAt: null, path: { not: PENDING_PATH } },
      select: { id: true },
    });
    if (usable) patch.fileId = old.fileId;
  }
  const saved = await saveCardEdit(actor, cardId, patch, { baseVersion });
  if (saved.applied) await recordCard(actor, row, "restored", { fromVersion: version, version: saved.card.version ?? 0 });
  return saved.card;
}
