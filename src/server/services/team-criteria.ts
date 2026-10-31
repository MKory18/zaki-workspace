import { z } from "zod";
import { db } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { devAccess } from "@/server/policy/team-development";
import { getServerT } from "@/lib/i18n/server";
import { CRITERIA_LIMITS, DEFAULT_CRITERIA } from "@/lib/team-reviews";

/**
 * «معايير التقييم» — the criteria a reviewer rates 1-5: the five the owner named (جودة الشغل، الالتزام بالمواعيد، التعاون، المبادرة،
 * التواصل), which the owner may rename, add to (at most 8 in use at once) and retire. A criterion is never deleted: it is
 * archived, so the ratings already given keep their meaning. They are written to the table the first time somebody asks.
 * Only the OWNER (and his partners) changes them; every staff member who may read reviews reads the list.
 */

const invalid = (path: string, key: string) => new ValidationError([{ path, message: key }]);

export interface CriterionDTO {
  id: string;
  code: string;
  name: string;
  position: number;
  archived: boolean;
}

export const criterionInputSchema = z.object({
  name: z.string({ required_error: "teamdev.criterion_name_required" }).trim().min(1, "teamdev.criterion_name_required").max(CRITERIA_LIMITS.name, "teamdev.criterion_name_long"),
});
export const criterionPatchSchema = z
  .object({
    name: z.string().trim().min(1, "teamdev.criterion_name_required").max(CRITERIA_LIMITS.name, "teamdev.criterion_name_long").optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.archived !== undefined, { message: "teamdev.no_change" });

/** The five defaults, written once (two requests at once write them once: the unique `(organizationId, code)` decides). */
export async function ensureCriteria(orgId: string): Promise<void> {
  if ((await db.reviewCriterion.count({ where: { organizationId: orgId } })) > 0) return;
  const { t } = getServerT();
  await db.reviewCriterion.createMany({
    data: DEFAULT_CRITERIA.map((c, position) => ({ organizationId: orgId, code: c.code, name: t(c.nameKey), position })),
    skipDuplicates: true,
  });
}

const toDto = (c: { id: string; code: string; name: string; position: number; archivedAt: Date | null }): CriterionDTO => ({
  id: c.id,
  code: c.code,
  name: c.name,
  position: c.position,
  archived: c.archivedAt !== null,
});

/** The criteria in their order. `all` adds the archived ones (the screens that show old reviews need their names). */
export async function listCriteria(actor: Actor, opts: { all?: boolean } = {}): Promise<CriterionDTO[]> {
  const access = await devAccess(actor);
  await ensureCriteria(access.orgId);
  const rows = await db.reviewCriterion.findMany({
    where: { organizationId: access.orgId, ...(opts.all ? {} : { archivedAt: null }) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDto);
}

function ownerOnly(isOwner: boolean): void {
  // the door is not offered to anybody else: 404, like every other door of this feature
  if (!isOwner) throw new NotFoundError("teamdev.not_found");
}

export async function addCriterion(actor: Actor, name: string): Promise<CriterionDTO> {
  const access = await devAccess(actor);
  ownerOnly(access.isOwner);
  await ensureCriteria(access.orgId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(41004::int, hashtext(${access.orgId}))`;
    const rows = await tx.reviewCriterion.findMany({ where: { organizationId: access.orgId }, select: { name: true, archivedAt: true, position: true } });
    const live = rows.filter((r) => r.archivedAt === null);
    if (live.length >= CRITERIA_LIMITS.maxLive) throw invalid("name", "teamdev.criteria_limit");
    if (rows.length >= CRITERIA_LIMITS.maxAll) throw invalid("name", "teamdev.criteria_limit_all");
    if (live.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw invalid("name", "teamdev.criterion_name_taken");
    const row = await tx.reviewCriterion.create({
      data: { organizationId: access.orgId, code: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, name, position: Math.max(-1, ...rows.map((r) => r.position)) + 1 },
    });
    return toDto(row);
  });
}

export async function updateCriterion(actor: Actor, id: string, patch: { name?: string; archived?: boolean }): Promise<CriterionDTO> {
  const access = await devAccess(actor);
  ownerOnly(access.isOwner);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(41004::int, hashtext(${access.orgId}))`;
    const row = await tx.reviewCriterion.findFirst({ where: { id, organizationId: access.orgId } });
    if (!row) throw new NotFoundError("teamdev.not_found");
    const live = await tx.reviewCriterion.findMany({ where: { organizationId: access.orgId, archivedAt: null, id: { not: id } }, select: { name: true } });
    const willBeLive = patch.archived === undefined ? row.archivedAt === null : !patch.archived;
    const name = patch.name ?? row.name;
    if (willBeLive && live.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw invalid("name", "teamdev.criterion_name_taken");
    if (willBeLive && row.archivedAt !== null && live.length >= CRITERIA_LIMITS.maxLive) throw invalid("name", "teamdev.criteria_limit");
    // a company with no criterion in use could rate nothing
    if (!willBeLive && row.archivedAt === null && live.length === 0) throw invalid("archived", "teamdev.criteria_last");
    const updated = await tx.reviewCriterion.update({
      where: { id },
      data: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.archived !== undefined ? { archivedAt: patch.archived ? (row.archivedAt ?? new Date()) : null } : {}) },
    });
    return toDto(updated);
  });
}
