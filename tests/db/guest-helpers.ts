import type { CampaignStatus, TicketStatus } from "@prisma/client";
import { db, makeUser, uid } from "./helpers";

/**
 * Fixtures for the GUEST batch (CRM, tickets, campaigns, directory).
 * Everything is created with `db.*.create`, so the fixtures never depend on the
 * services whose behaviour the tests are checking.
 */

/** Next per-org sequential number (tasks, tickets, campaigns and opportunities share it). */
async function nextNumber(orgId: string): Promise<number> {
  return db.$transaction(async (tx) => {
    const counter = await tx.taskCounter.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return counter.lastNumber;
  });
}

export async function makeDepartment(
  orgId: string,
  opts: { memberIds?: string[]; leadId?: string | null; name?: string } = {},
) {
  return db.department.create({
    data: {
      orgId,
      name: opts.name ?? `Dept ${uid()}`,
      leadId: opts.leadId ?? null,
      memberships: { create: (opts.memberIds ?? []).map((userId) => ({ userId })) },
    },
  });
}

export async function makeTicket(opts: {
  orgId: string;
  departmentId: string;
  creatorId: string;
  assigneeId?: string | null;
  status?: TicketStatus;
  title?: string;
}) {
  return db.ticket.create({
    data: {
      orgId: opts.orgId,
      departmentId: opts.departmentId,
      number: await nextNumber(opts.orgId),
      title: opts.title ?? `Ticket ${uid()}`,
      creatorId: opts.creatorId,
      assigneeId: opts.assigneeId ?? null,
      status: opts.status ?? "OPEN",
    },
  });
}

export async function makeTicketComment(ticketId: string, authorId: string, body = "old comment") {
  return db.ticketComment.create({ data: { ticketId, authorId, body } });
}

export async function makeCampaign(opts: {
  orgId: string;
  departmentId: string;
  ownerId: string;
  status?: CampaignStatus;
  title?: string;
}) {
  return db.campaign.create({
    data: {
      orgId: opts.orgId,
      departmentId: opts.departmentId,
      number: await nextNumber(opts.orgId),
      title: opts.title ?? `Campaign ${uid()}`,
      status: opts.status ?? "DRAFT",
      startDate: new Date("2026-11-01T12:00:00.000Z"),
      endDate: new Date("2026-11-30T12:00:00.000Z"),
      ownerId: opts.ownerId,
    },
  });
}

export async function makeCampaignItem(campaignId: string, title = "Item") {
  return db.campaignItem.create({
    data: { campaignId, title, kind: "post", dueDate: new Date("2026-11-05T12:00:00.000Z") },
  });
}

export async function makeCustomer(opts: { orgId: string; creatorId: string; name?: string }) {
  return db.customer.create({
    data: {
      orgId: opts.orgId,
      name: opts.name ?? `Customer ${uid()}`,
      company: "ACME",
      email: `customer-${uid()}@acme.test`,
      creatorId: opts.creatorId,
    },
  });
}

export async function makeOpportunity(opts: {
  orgId: string;
  customerId: string;
  ownerId: string;
  value?: number;
  title?: string;
}) {
  return db.opportunity.create({
    data: {
      orgId: opts.orgId,
      number: await nextNumber(opts.orgId),
      customerId: opts.customerId,
      title: opts.title ?? `Opportunity ${uid()}`,
      value: opts.value ?? 123456,
      ownerId: opts.ownerId,
    },
  });
}

/** A plain MEMBER of an existing org (for roles the standard team does not have). */
export async function makeMember(orgId: string, name: string) {
  return makeUser({ orgId, role: "MEMBER", name });
}

/** A daily-production routine (empty `weekdays` = it runs every day). */
export async function makeRoutine(opts: {
  orgId: string;
  title?: string;
  assigneeId?: string | null;
  departmentId?: string | null;
  weekdays?: string;
}) {
  return db.routine.create({
    data: {
      orgId: opts.orgId,
      title: opts.title ?? `Routine ${uid()}`,
      assigneeId: opts.assigneeId ?? null,
      departmentId: opts.departmentId ?? null,
      weekdays: opts.weekdays ?? "",
    },
  });
}

/** "This routine was ticked off on that day" (`day` is YYYY-MM-DD). */
export async function makeRoutineLog(routineId: string, day: string, completedById: string) {
  return db.routineLog.create({ data: { routineId, day, completedById } });
}

/** Sets the profile fields the staff directory shows. */
export async function setProfile(userId: string, data: { jobTitle?: string; bio?: string }) {
  return db.user.update({ where: { id: userId }, data });
}
