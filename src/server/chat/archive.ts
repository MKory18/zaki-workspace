import { db } from "@/server/db";
import { ForbiddenError, type OrgAccessContext } from "@/server/auth";
import { canArchive } from "@/server/policy/conversation";
import type { ArchiveItemDto, ArchivePageDto, ArchiveType } from "@/server/chat/dto";
import { logChat } from "@/server/chat/moderation";

/**
 * The archive: the OWNER's record of what happened — deleted messages (with the text that was
 * deleted and who deleted it), edits (the version before each edit), moderation acts, and closed
 * topics. Nobody else reads it: `canArchive` is OWNER only.
 *
 * Pagination is a cursor (the id of the last item on the page). The items come from four
 * different tables, so the cursor is a composite `<kind>:<id>` and each source is asked for its
 * own slice: the page is assembled newest-first from the four, and the cursor is the last item's
 * stamp. Reading the archive is itself an audited act.
 */

export const archiveQuerySchema = {
  type: ["deleted", "edited", "moderation", "closed"] as ArchiveType[],
};

const PAGE = 40;

export async function readArchive(
  ctx: OrgAccessContext,
  opts: { type?: ArchiveType; spaceId?: string; personId?: string; from?: string; to?: string; cursor?: string; limit?: number } = {},
): Promise<ArchivePageDto> {
  const role = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId },
      status: "ACTIVE",
    },
    select: { role: true },
  });
  if (!canArchive(role?.role)) throw new ForbiddenError("chat.e.archive_denied");

  const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), 100);
  const cursor = parseCursor(opts.cursor);
  const from = opts.from ? new Date(`${opts.from}T00:00:00.000Z`) : undefined;
  const to = opts.to ? new Date(`${opts.to}T23:59:59.999Z`) : undefined;
  const eventRange = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

  const wantDeleted = !opts.type || opts.type === "deleted";
  const wantEdited = !opts.type || opts.type === "edited";
  const wantModeration = !opts.type || opts.type === "moderation";
  const wantClosed = !opts.type || opts.type === "closed";

  const items: ArchiveItemDto[] = [];

  if (wantDeleted) {
    const rows = await db.chatMessage.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: { not: null, ...(eventRange ?? {}) },
        ...(opts.personId ? { authorId: opts.personId } : {}),
        ...(opts.spaceId ? { conversation: { spaceId: opts.spaceId } } : {}),
        ...(cursor && cursor.kind === "deleted" ? { id: { lt: cursor.id } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      select: {
        id: true,
        body: true,
        authorId: true,
        conversationId: true,
        deletedAt: true,
        author: { select: { name: true } },
        deletedBy: { select: { name: true } },
        conversation: { select: { spaceId: true, space: { select: { name: true } } } },
      },
    });
    for (const r of rows.slice(0, limit)) {
      items.push({
        type: "deleted",
        id: r.id,
        conversationId: r.conversationId,
        spaceId: r.conversation.spaceId,
        spaceName: r.conversation.space?.name ?? null,
        messageId: r.id,
        body: r.body, // the OWNER sees what was deleted
        authorId: r.authorId,
        authorName: r.author.name,
        at: r.deletedAt!.toISOString(),
        deletedByName: r.deletedBy?.name ?? null,
        deletedAt: r.deletedAt!.toISOString(),
      });
    }
  }

  if (wantEdited) {
    const rows = await db.chatMessage.findMany({
      where: {
        orgId: ctx.orgId,
        editedAt: { not: null, ...(eventRange ?? {}) },
        ...(opts.personId ? { authorId: opts.personId } : {}),
        deletedAt: null,
        ...(opts.spaceId ? { conversation: { spaceId: opts.spaceId } } : {}),
        ...(cursor && cursor.kind === "edited" ? { id: { lt: cursor.id } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      select: {
        id: true,
        body: true,
        authorId: true,
        conversationId: true,
        editedAt: true,
        author: { select: { name: true } },
        conversation: { select: { spaceId: true, space: { select: { name: true } } } },
        revisions: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
      },
    });
    for (const r of rows.slice(0, limit)) {
      items.push({
        type: "edited",
        id: r.id,
        conversationId: r.conversationId,
        spaceId: r.conversation.spaceId,
        spaceName: r.conversation.space?.name ?? null,
        messageId: r.id,
        body: r.body,
        previousBody: r.revisions[0]?.body ?? null,
        authorId: r.authorId,
        authorName: r.author.name,
        at: r.editedAt!.toISOString(),
      });
    }
  }

  if (wantModeration) {
    const rows = await db.auditLog.findMany({
      where: {
        orgId: ctx.orgId,
        action: { startsWith: "chat." },
        ...(opts.spaceId ? { workspaceId: opts.spaceId } : {}),
        ...(opts.personId ? { OR: [{ actorId: opts.personId }, { target: opts.personId }] } : {}),
        ...(eventRange ? { createdAt: eventRange } : {}),
        ...(cursor && cursor.kind === "moderation" ? { id: { lt: cursor.id } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => !!v))];
    const targetIds = [...new Set(rows.map((r) => r.target).filter((v): v is string => !!v))];
    const users = await db.user.findMany({ where: { id: { in: [...new Set([...actorIds, ...targetIds])] } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    for (const r of rows.slice(0, limit)) {
      items.push({
        type: "moderation",
        id: r.id,
        conversationId: r.conversationId,
        spaceId: r.workspaceId,
        spaceName: null,
        action: r.action,
        actorName: r.actorId ? (nameOf.get(r.actorId) ?? "") : "",
        targetName: r.target ? (nameOf.get(r.target) ?? "") : null,
        meta: (r.meta as Record<string, unknown> | null) ?? null,
        at: r.createdAt.toISOString(),
      });
    }
  }

  if (wantClosed && !opts.personId) {
    const rows = await db.conversation.findMany({
      where: {
        orgId: ctx.orgId,
        kind: "TOPIC",
        closedAt: { not: null, ...(eventRange ?? {}) },
        ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
        ...(cursor && cursor.kind === "closed" ? { id: { lt: cursor.id } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      select: { id: true, title: true, spaceId: true, closedAt: true, space: { select: { name: true } } },
    });
    for (const r of rows.slice(0, limit)) {
      items.push({
        type: "closed",
        id: r.id,
        conversationId: r.id,
        spaceId: r.spaceId,
        spaceName: r.space?.name ?? null,
        title: r.title,
        at: r.closedAt!.toISOString(),
      });
    }
  }

  // newest first across the four sources
  items.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const page = items.slice(0, limit);
  const last = page[page.length - 1];

  await logChat({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "chat.archive_read",
    spaceId: opts.spaceId ?? null,
    meta: { type: opts.type ?? "all" },
  });

  return {
    items: page,
    nextCursor: last ? `${last.type}:${last.id}` : null,
  };
}

function parseCursor(cursor: string | undefined): { kind: ArchiveType; id: string } | null {
  if (!cursor) return null;
  const i = cursor.indexOf(":");
  if (i <= 0) return null;
  const kind = cursor.slice(0, i) as ArchiveType;
  const id = cursor.slice(i + 1);
  if (!["deleted", "edited", "moderation", "closed"].includes(kind) || !id) return null;
  return { kind, id };
}
