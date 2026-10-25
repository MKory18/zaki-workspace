import { z } from "zod";
import type { TicketStatus } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import { enumLabel } from "@/lib/i18n/enums";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { nextTaskNumber, type Tx } from "@/server/services/tasks";
import { pushNotificationToMany } from "@/server/notify";
import { assertCanWrite } from "@/server/services/guest-guard";
import { assertActiveAssignee } from "@/server/services/active-people";

/**
 * IT tickets live inside a department. Access policy:
 * - org GUESTs: no access. The read routes refuse them (assertNotGuest, 403), and
 *   they cannot create, edit, comment, change a status or delete anything
 *   (assertCanWrite), whatever their ticket/department links are.
 * - org OWNER/ADMIN: full manage
 * - department members and the department lead: create, assign within the
 *   department, transition status
 * - the assignee: works the ticket through its whole lifecycle
 * - the creator: may edit or delete it while it is still OPEN (see canEditTicket)
 * - everybody else: org-wide visibility is intentional for support desks and any
 *   (non-guest) org member may open a ticket or comment, but may NOT edit or
 *   close somebody else's ticket.
 * - a ticket is only ever handed to an ACTIVE member of the organization (not a suspended or an
 *   offboarded person, not a stranger), whoever hands it; a ticket somebody already holds stays
 *   readable and editable around them until it is moved.
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

export interface TicketEditFacts {
  isAdmin: boolean; // org OWNER / ADMIN
  isDeptMember: boolean; // has a DepartmentMember row for the ticket's department
  isDeptLead: boolean; // is Department.leadId
  isCreator: boolean;
  isAssignee: boolean;
  status: TicketStatus;
}

/**
 * Who may edit a ticket or change its status (the status path itself is still
 * limited by canTransition). Admins, department members, the department lead and
 * the assignee may at every status. A creator who is none of those keeps the old
 * limit: only while the ticket is still OPEN. Anyone else may not touch it.
 * (Guests are refused before this is asked, by assertCanWrite.)
 */
export function canEditTicket(f: TicketEditFacts): boolean {
  if (f.isAdmin || f.isDeptMember || f.isDeptLead || f.isAssignee) return true;
  return f.isCreator && f.status === "OPEN";
}

async function departmentContext(ctx: OrgAccessContext, departmentId: string) {
  const dept = await db.department.findFirst({
    where: { id: departmentId, orgId: ctx.orgId },
    select: { id: true, name: true, leadId: true, memberships: { select: { userId: true } } },
  });
  if (!dept) throw new NotFoundError("dept.not_found");
  const isMember = dept.memberships.some((m) => m.userId === ctx.userId);
  const isLead = dept.leadId === ctx.userId;
  const isAdmin = ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN";
  return { dept, isMember, isLead, isAdmin };
}

/** The facts `canEditTicket` needs for this actor and this ticket. Editing and deleting share them. */
async function ticketEditFacts(
  ctx: OrgAccessContext,
  ticket: Awaited<ReturnType<typeof loadTicketForOrg>>,
): Promise<TicketEditFacts> {
  const { isMember, isLead, isAdmin } = await departmentContext(ctx, ticket.departmentId);
  return {
    isAdmin,
    isDeptMember: isMember,
    isDeptLead: isLead,
    isCreator: ticket.creatorId === ctx.userId,
    isAssignee: ticket.assigneeId === ctx.userId,
    status: ticket.status,
  };
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
  assertCanWrite(ctx);
  const { dept } = await departmentContext(ctx, departmentId);
  if (input.assigneeId) {
    const ok = dept.memberships.some((m) => m.userId === input.assigneeId) || ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN";
    if (!ok) throw new ForbiddenError("ticket.assignee_not_member");
    await assertActiveAssignee(ctx.orgId, input.assigneeId);
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
      title: AR["notif.type.ticket_assigned"] ?? "إشعار",
      body: `${org?.keyPrefix ?? "ZK"}-T${ticket.number} · ${ticket.title}`,  // the label is machine text; the title is what the bell prints
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

/** Comments: any org member except a guest may comment; author or org admin may edit/delete. */
export async function addTicketComment(ctx: OrgAccessContext, ticketId: string, body: string) {
  assertCanWrite(ctx);
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
      title: AR["notif.type.ticket_comment"] ?? "إشعار",
      body: `${org?.keyPrefix ?? "ZK"}-T${ticket.number} · ${body.slice(0, 120)}`,  // the label rides in the body
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
  assertCanWrite(ctx);
  const ticket = await loadTicketForOrg(ctx.orgId, ticketId);
  const comment = await db.ticketComment.findFirst({ where: { id: commentId, ticketId: ticket.id }, select: { id: true, authorId: true } });
  if (!comment) throw new NotFoundError("comment.not_found");
  if (comment.authorId !== ctx.userId && ctx.orgRole !== "OWNER" && ctx.orgRole !== "ADMIN") {
    throw new ForbiddenError("comment.not_yours");
  }
  return db.ticketComment.update({ where: { id: comment.id }, data: { body, editedAt: new Date() } });
}

export async function deleteTicketComment(ctx: OrgAccessContext, ticketId: string, commentId: string) {
  assertCanWrite(ctx);
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
  assertCanWrite(ctx);
  const ticket = await loadTicketForOrg(ctx.orgId, ticketId);
  if (!canEditTicket(await ticketEditFacts(ctx, ticket))) throw new ForbiddenError("ticket.admin_only");
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
    // handing it to somebody NEW: they must be active (re-sending the current assignee, who may have
    // been suspended since, changes nothing and is not re-checked)
    if (input.assigneeId !== ticket.assigneeId) await assertActiveAssignee(ctx.orgId, input.assigneeId);
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
      title: AR["notif.type.ticket_assigned"] ?? "إشعار",
      body: `${org?.keyPrefix ?? "ZK"}-T${ticket.number} · ${ticket.title}`,  // the label is machine text; the title is what the bell prints
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
        title: AR["notif.type.ticket_status"] ?? "إشعار",
        // the status is an English enum on the wire; the bell gets its Arabic name from the dictionary
        body: `${org?.keyPrefix ?? "ZK"}-T${ticket.number} · ${ticket.title} → ${enumLabel("TicketStatus", input.status)}`,
        linkUrl: "/departments",
      });
    }
  }
  return updated;
}

/** Deleting follows the same rule as editing (canEditTicket): the creator only while the ticket is OPEN. */
export async function deleteTicket(ctx: OrgAccessContext, ticketId: string): Promise<void> {
  assertCanWrite(ctx);
  const ticket = await loadTicketForOrg(ctx.orgId, ticketId);
  if (!canEditTicket(await ticketEditFacts(ctx, ticket))) throw new ForbiddenError("ticket.admin_only");
  await db.ticket.delete({ where: { id: ticket.id } });
}
