import { z } from "zod";
import type { OpportunityStage } from "@prisma/client";
import { db } from "@/server/db";
import { NotFoundError, audit, type OrgAccessContext } from "@/server/auth";
import { nextTaskNumber, type Tx } from "@/server/services/tasks";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertCapability } from "@/server/services/active-people";
import { mySpacesWhere, placeWhere, type SpacePlace } from "@/server/services/space-place";

export const OPPORTUNITY_STAGES = [
  "LEAD",
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const satisfies readonly [string, ...string[]];

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, "crm.name_too_short").max(150),
  company: z.string().trim().max(150).nullable().optional(),
  email: z.string().trim().email("crm.invalid_email").max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "crm.no_change" },
);

export const createOpportunitySchema = z.object({
  customerId: z.string().min(1),
  title: z.string().trim().min(3, "crm.title_too_short").max(200),
  value: z.number().min(0).default(0),
  stage: z.enum(OPPORTUNITY_STAGES).default("LEAD"),
  expectedCloseAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const updateOpportunitySchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    value: z.number().min(0).optional(),
    stage: z.enum(OPPORTUNITY_STAGES).optional(),
    expectedCloseAt: z.string().datetime().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "crm.no_change" });

export type CustomerInput = z.infer<typeof createCustomerSchema>;
export type OpportunityInput = z.infer<typeof createOpportunitySchema>;

/**
 * CRM is staff-only and runs on two capabilities: `crm.view` for every read, `crm.edit` for every
 * create, update and delete. Members, team leads and admins hold both by default (the owner can
 * switch either off for one person: 403 `insufficient_role`); org GUESTs hold neither and keep the
 * message they always got (`guest.no_access`). Opportunity `value` is price data, but hiding it
 * from staff is `prices.view`'s job, which is wired later - not here.
 * Every exported function below takes the caller's context for that.
 */
async function assertCrm(ctx: OrgAccessContext, capability: "crm.view" | "crm.edit"): Promise<void> {
  assertNotGuest(ctx);
  await assertCapability(ctx, capability);
}

export async function listCustomers(ctx: OrgAccessContext, place?: SpacePlace) {
  await assertCrm(ctx, "crm.view");
  return db.customer.findMany({
    // the space the person is in (and in «الشركة» the ones from before spaces had their own)
    where: { orgId: ctx.orgId, ...(place ? { AND: [placeWhere(place)] } : {}) },
    orderBy: { createdAt: "desc" },
    include: { creator: { select: { id: true, name: true } } },
  });
}

export async function getCustomer(ctx: OrgAccessContext, id: string) {
  await assertCrm(ctx, "crm.view");
  const customer = await db.customer.findFirst({
    where: { id, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] },
    include: {
      creator: { select: { id: true, name: true } },
      opportunities: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!customer) throw new NotFoundError("crm.not_found");
  return customer;
}

export async function createCustomer(ctx: OrgAccessContext, input: CustomerInput, spaceId: string | null = null) {
  await assertCrm(ctx, "crm.edit");
  const customer = await db.customer.create({
    data: {
      orgId: ctx.orgId,
      name: input.name,
      company: input.company ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      notes: input.notes ?? null,
      creatorId: ctx.userId,
      // added in the space the person is in
      workspaceId: spaceId,
    },
  });
  await audit("crm.customer_created", { actorId: ctx.userId, orgId: ctx.orgId, target: customer.id });
  return customer;
}

export async function updateCustomer(ctx: OrgAccessContext, id: string, input: Partial<CustomerInput>) {
  await assertCrm(ctx, "crm.edit");
  const customer = await db.customer.findFirst({ where: { id, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] } });
  if (!customer) throw new NotFoundError("crm.not_found");
  const updated = await db.customer.update({ where: { id: customer.id }, data: input });
  await audit("crm.customer_updated", { actorId: ctx.userId, orgId: ctx.orgId, target: customer.id });
  return updated;
}

export async function deleteCustomer(ctx: OrgAccessContext, id: string) {
  await assertCrm(ctx, "crm.edit");
  const customer = await db.customer.findFirst({ where: { id, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] } });
  if (!customer) throw new NotFoundError("crm.not_found");
  await db.customer.delete({ where: { id: customer.id } });
  await audit("crm.customer_deleted", { actorId: ctx.userId, orgId: ctx.orgId, target: customer.id });
}

export async function listOpportunities(ctx: OrgAccessContext, place?: SpacePlace) {
  await assertCrm(ctx, "crm.view");
  return db.opportunity.findMany({
    // the space the person is in (and in «الشركة» the ones from before spaces had their own)
    where: { orgId: ctx.orgId, ...(place ? { AND: [placeWhere(place)] } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { id: true, name: true, company: true } },
      owner: { select: { id: true, name: true } },
    },
  });
}

export async function getOpportunity(ctx: OrgAccessContext, id: string) {
  await assertCrm(ctx, "crm.view");
  const opportunity = await db.opportunity.findFirst({
    where: { id, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] },
    include: {
      customer: { select: { id: true, name: true, company: true, email: true, phone: true } },
      owner: { select: { id: true, name: true } },
    },
  });
  if (!opportunity) throw new NotFoundError("crm.not_found");
  return opportunity;
}

export async function createOpportunity(ctx: OrgAccessContext, input: OpportunityInput) {
  await assertCrm(ctx, "crm.edit");
  const customer = await db.customer.findFirst({ where: { id: input.customerId, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] } });
  if (!customer) throw new NotFoundError("crm.not_found");

  const opportunity = await db.$transaction(async (tx: Tx) => {
    const num = await nextTaskNumber(ctx.orgId, tx);
    return tx.opportunity.create({
      data: {
        orgId: ctx.orgId,
        number: num,
        customerId: input.customerId,
        title: input.title,
        value: input.value,
        stage: input.stage,
        expectedCloseAt: input.expectedCloseAt ? new Date(input.expectedCloseAt) : null,
        notes: input.notes ?? null,
        ownerId: ctx.userId,
        // an opportunity lives where its customer does
        workspaceId: customer.workspaceId,
      },
    });
  });

  await audit("crm.opportunity_created", { actorId: ctx.userId, orgId: ctx.orgId, target: opportunity.id });
  return opportunity;
}

export async function updateOpportunity(
  ctx: OrgAccessContext,
  id: string,
  input: Partial<OpportunityInput>,
) {
  await assertCrm(ctx, "crm.edit");
  const opportunity = await db.opportunity.findFirst({ where: { id, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] } });
  if (!opportunity) throw new NotFoundError("crm.not_found");

  const data: Record<string, unknown> = { ...input };
  if (input.expectedCloseAt !== undefined) {
    data.expectedCloseAt = input.expectedCloseAt ? new Date(input.expectedCloseAt) : null;
  }
  delete data.customerId;

  const updated = await db.opportunity.update({ where: { id: opportunity.id }, data });
  await audit("crm.opportunity_updated", { actorId: ctx.userId, orgId: ctx.orgId, target: opportunity.id });
  return updated;
}

export async function deleteOpportunity(ctx: OrgAccessContext, id: string) {
  await assertCrm(ctx, "crm.edit");
  const opportunity = await db.opportunity.findFirst({ where: { id, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] } });
  if (!opportunity) throw new NotFoundError("crm.not_found");
  await db.opportunity.delete({ where: { id: opportunity.id } });
  await audit("crm.opportunity_deleted", { actorId: ctx.userId, orgId: ctx.orgId, target: opportunity.id });
}
