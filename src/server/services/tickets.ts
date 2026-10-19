import { z } from "zod";
import type { TicketStatus } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { nextTaskNumber, type Tx } from "@/server/services/tasks";
import { pushNotificationToMany } from "@/server/notify";

/**
 * IT tickets live inside a department. Access policy:
 * - org OWNER/ADMIN: full manage
 * - department members: create, assign within the department, transition status
 * - other org members: read-only inside their org? NO — org-wide visibility is
 *   intentional for support desks: any org member may create a ticket; only
 *   dept members/org admins may assign or close.
 */

export const TICKET_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

export const createTicketSchema = z.object({
  title: z.string().trim().min(3, "title.too_short").max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).default("NORMAL"),
  assigneeId: z.string().nullable().optional(),
});

export const updateTicketSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
    priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).optional(),
    assigneeId: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "ticket.no_change" });

export const ticketCommentSchema = z.object({
  body: z.string().trim().min(1, "comment.required").max(4000),
});

/** Transitions anyone with write access may perform. */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true;
  if (from === "OPEN") return to === "IN_PROGRESS" || to === "RESOLVED" || to === "CLOSED";
  if (from === "IN_PROGRESS") return to === "RESOLVED" || to === "CLOSED" || to === "OPEN";
  if (from === "RESOLVED") return to === "CLOSED" || to === "IN_PROGRESS";
  return to === "OPEN"; // CLOSED reopens
}

export async function nextTicketNumber(orgId: string, tx: Tx): Promise<number> {
  return nextTaskNumber(orgId, tx);
}

async function departmentContext(ctx: OrgAccessContext, departmentId: string) {
  const dept = await db.department.findFirst({
    where: { id: departmentId, orgId: ctx.orgId },
    select: { id: true, name: true, memberships: { select: { userId: true } } },
  });
  if (!dept) throw new NotFoundError("dept.not_found");
  const isMember = dept.memberships.some((m) => m.userId === ctx.userId);
  const isAdmin = ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN";
  return { dept, isMember, isAdmin };
}

export async function listDepartmentTickets(departmentId: string) {
  return db.ticket.findMany({
    where: { departmentId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      number: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      resolvedAt: true,
      createdAt: true,
      creator: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
    },
  });
}

export async function createTicket(
  ctx: OrgAccessContext,
  departmentId: string,
  input: z.infer<typeof createTicketSchema>,
) {
  const { dept } = await departmentContext(ctx, departmentId);
  if (input.assigneeId) {
    const ok = dept.memberships.some((m) => m.userId === input.assigneeId) || ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN";
    if (!ok) throw new ForbiddenError("ticket.assignee_not_member");
  }
  const ticket = await db.$transaction(async (tx) => {
    const number = await nextTicketNumber(ctx.orgId, tx);
    const created = await tx.ticket.create({
      data: {
        orgId: ctx.orgId,
        departmentId: dept.id,
        number,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        creatorId: ctx.userId,
        assigneeId: input.assigneeId ?? null,
      },
      select: { id: true, number: true, title: true },
    });
    await tx.ticketActivity.create({
      data: { ticketId: created.id, actorId: ctx.userId, event: "created" },
    });
    if (input.assigneeId) {
      await tx.ticketActivity.create({
        data: {
          ticketId: created.id,
          actorId: ctx.userId,
          event: "assigned",
          meta: { assigneeId: input.assigneeId },
        },
      });
    }
    return created;
  });
  if (input.assigneeId) {
    const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { keyPrefix: true } });
    await pushNotificationToMany([input.assigneeId], {
      type: "ticket_assigned",
      title: `${org?.keyPrefix ?? "ZK"}-T${ticket.number}`,
      body: ticket.title,
      linkUrl: "/departments",
    });
  }
  return ticket;
}

/** Caller must already be workspace/org-gated for the ticket's org. */
export async function loadTicketForOrg(orgId: string, ticketId: string) {
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, orgId },
    select: { id: true, orgId: true, departmentId: true, status: true, number: true, title: true, assigneeId: true, creatorId: true },
  });
  if (!ticket) throw new NotFoundError("ticket.not_found");
  return ticket;
}

/** Org-member gate + read access for a single ticket (any org member can view). */
export async function ticketDetail(ctx: OrgAccessContext, ticketId: string) {
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, orgId: ctx.orgId },
    select: {
      id: true, orgId: true, departmentId: true, number: true, title: true,
      description: true, status: true, priority: true, resolvedAt: true, createdAt: true,
      creator: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, editedAt: true, createdAt: true, author: { select: { id: true, name: true } } },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, event: true, meta: true, createdAt: true, actor: { select: { id: true, name: true } } },
      },
    },
  });
  if (!ticket) throw new NotFoundError("ticket.not_found");
  return ticket;
}

/** Comments: any org member may comment; author or org admin may edit/delete. */
export async function addTicketComment(ctx: OrgAccessContext, ticketId: string, body: string) {
  const ticket = await loadTicketForOrg(ctx.orgId, ticketId);
  const comment = await db.$transaction(async (tx) => {
    const c = await tx.ticketComment.create({
      data: { ticketId: ticket.id, authorId: ctx.userId, body },
      select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true } } },
    });
    await tx.ticketActivity.create({
      data: { ticketId: ticket.id, actorId: ctx.userId, event: "commented", meta: { commentId: c.id } },
    });
    return c;
  });
  // notify assignee + creator, never the comment author
  const watchers = [ticket.assigneeId, ticket.creatorId].filter(
    (id): id is string => id !== null && id !== ctx.userId,
  );
  if (watchers.length) {
    const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { keyPrefix: true } });
    await pushNotificationToMany([...new Set(watchers)], {
      type: "ticket_comment",
      title: `${org?.keyPrefix ?? "ZK"}-T${ticket.number}`,
      body: `${ctx.userId === ticket.assigneeId ? "" : ""}${body.slice(0, 120)}`,
      linkUrl: "/departments",
    });
  }
  return comment;
}

export async function listTicketComments(ticketId: string) {
  return db.ticketComment.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, editedAt: true, createdAt: true, author: { select: { id: true, name: true } } },
  });
}

export async function listTicketActivity(ticketId: string) {
  return db.ticketActivity.findMany({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, event: true, meta: true, createdAt: true, actor: { select: { id: true, name: true } } },
  });
}

export async function editTicketComment(ctx: OrgAccessContext, ticketId: string, commentId: string, body: string) {
  const ticket = await loadTicketForOrg(ctx.orgId, ticketId);
  const comment = await db.ticketComment.findFirst({ where: { id: commentId, ticketId: ticket.id }, select: { id: true, authorId: true } });
  if (!comment) throw new NotFoundError("comment.not_found");
  if (comment.authorId !== ctx.userId && ctx.orgRole !== "OWNER" && ctx.orgRole !== "ADMIN") {
    throw new ForbiddenError("comment.not_yours");
  }
  return db.ticketComment.update({ where: { id: comment.id }, data: { body, editedAt: new Date() } });
}

export async function deleteTicketComment(ctx: OrgAccessContext, ticketId: string, commentId: string) {
  const ticket = await loadTicketForOrg(ctx.orgId, ticketId);
  const comment = await db.ticketComment.findFirst({ where: { id: commentId, ticketId: ticket.id }, select: { id: true, authorId: true } });
  if (!comment) throw new NotFoundError("comment.not_found");
  if (comment.authorId !== ctx.userId && ctx.orgRole !== "OWNER" && ctx.orgRole !== "ADMIN") {
    throw new ForbiddenError("comment.not_yours");
  }
  await db.ticketComment.delete({ where: { id: comment.id } });
}

/** "تذاكري" — tickets assigned to the caller (or created by them) in their org. */
export async function myTickets(ctx: OrgAccessContext) {
  return db.ticket.findMany({
    where: { orgId: ctx.orgId, OR: [{ assigneeId: ctx.userId }, { creatorId: ctx.userId }] },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true, number: true, title: true, status: true, priority: true, createdAt: true,
      department: { select: { id: true, name: true, emoji: true } },
      assignee: { select: { id: true, name: true } },
    },
  });
}

export async function updateTicket(
  ctx: OrgAccessContext,
  ticketId: string,
  input: z.infer<typeof updateTicketSchema>,
) {
  const ticket = await loadTicketForOrg(ctx.orgId, ticketId);
  const { isMember, isAdmin } = await departmentContext(ctx, ticket.departmentId);
  const canWrite = isMember || isAdmin;
  if (!canWrite) {
    // plain org members may only edit what they created while still OPEN
    if (ticket.status !== "OPEN") throw new ForbiddenError("ticket.admin_only");
  }
  if (input.assigneeId) {
    const dept = await db.department.findFirst({
      where: { id: ticket.departmentId },
      select: { memberships: { select: { userId: true } } },
    });
    const ok =
      ctx.orgRole === "OWNER" ||
      ctx.orgRole === "ADMIN" ||
      (dept?.memberships.some((m) => m.userId === input.assigneeId) ?? false);
    if (!ok) throw new ForbiddenError("ticket.assignee_not_member");
  }
  if (input.status && !canTransition(ticket.status, input.status)) {
    throw new ForbiddenError("ticket.bad_transition");
  }
  const statusChanged = input.status !== undefined && input.status !== ticket.status;
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        title: input.title ?? undefined,
        description: input.description ?? undefined,
        status: input.status ?? undefined,
        priority: input.priority ?? undefined,
        assigneeId: input.assigneeId ?? undefined,
        resolvedAt: input.status === "RESOLVED" ? new Date() : input.status === "OPEN" || input.status === "IN_PROGRESS" ? null : undefined,
      },
      select: { id: true, number: true, status: true, assigneeId: true },
    });
    const events: { event: string; meta?: Record<string, unknown> }[] = [];
    if (input.title !== undefined || input.description !== undefined || input.priority !== undefined) {
      events.push({ event: "edited", meta: { fields: Object.keys(input).filter((k) => k !== "status" && k !== "assigneeId") } });
    }
    if (statusChanged) events.push({ event: "status_changed", meta: { from: ticket.status, to: input.status } });
    const assigneeChanged = input.assigneeId !== undefined && input.assigneeId !== ticket.assigneeId;
    if (assigneeChanged) events.push({ event: "assigned", meta: { assigneeId: input.assigneeId } });
    for (const e of events) {
      await tx.ticketActivity.create({
        data: { ticketId: ticket.id, actorId: ctx.userId, event: e.event, meta: e.meta as Record<string, string> },
      });
    }
    return row;
  });
  if (input.assigneeId && input.assigneeId !== ticket.assigneeId) {
    const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { keyPrefix: true } });
    await pushNotificationToMany([input.assigneeId], {
      type: "ticket_assigned",
      title: `${org?.keyPrefix ?? "ZK"}-T${ticket.number}`,
      body: ticket.title,
      linkUrl: "/departments",
    });
  }
  if (statusChanged) {
    // notify assignee + creator (never the actor) about the transition
    const watchers = [ticket.assigneeId, ticket.creatorId].filter(
      (id): id is string => id !== null && id !== ctx.userId,
    );
    if (watchers.length) {
      const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { keyPrefix: true } });
      await pushNotificationToMany([...new Set(watchers)], {
        type: "ticket_status",
        title: `${org?.keyPrefix ?? "ZK"}-T${ticket.number}`,
        body: `${ticket.title} → ${input.status}`,
        linkUrl: "/departments",
      });
    }
  }
  return updated;
}

export async function deleteTicket(ctx: OrgAccessContext, ticketId: string): Promise<void> {
  const ticket = await loadTicketForOrg(ctx.orgId, ticketId);
  const { isMember, isAdmin } = await departmentContext(ctx, ticket.departmentId);
  if (!isAdmin && !isMember && ticket.creatorId !== ctx.userId) throw new ForbiddenError("ticket.admin_only");
  await db.ticket.delete({ where: { id: ticket.id } });
}
