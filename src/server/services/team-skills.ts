import type { SkillSource } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { NotFoundError, ValidationError, ForbiddenError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertCanManageLines, assertMayEnterFor, assertMayOpenPerson, devAccess, isSelf, type DevAccess } from "@/server/policy/team-development";
import { SKILL_LIMITS, skillGap } from "@/lib/team-development";
import { buildCsv } from "@/lib/owner-board";

/**
 * «المهارات» — the company's skills checklist and each person's level in it.
 *
 *  - The CATALOGUE (name ≤ 60, category ≤ 40, description ≤ 300, at most 100 skills in all) is kept by the owner and whoever
 *    holds `people.manage_lines`. A skill is never deleted: it is archived (`archivedAt`) and its levels stay.
 *  - A LEVEL is 0..4 with a note ≤ 300, per person, per skill and per SOURCE: MANUAL (entered by the owner or by a supervisor
 *    holding `people.review` for somebody in their subtree) and SELF (the person's own estimate). The two are shown side by
 *    side, with the gap; the self estimate never replaces the supervisor's.
 *  - Every change of a level is a row of `PersonSkillHistory` (who, when, old → new, the note), written in the same transaction
 *    and never changed afterwards: the database refuses an UPDATE of that table.
 *
 * Who reads: the person (both columns, the gap, the history), the owner, and each supervisor for their subtree. Everybody
 * else gets 404. The catalogue itself (names only) is readable by every staff member, because everybody estimates themselves.
 */

const text = (max: number, key: string) => z.string({ invalid_type_error: key }).trim().max(max, key);
const blankToEmpty = (v: unknown) => (v === undefined || v === null ? "" : v);

export const skillInputSchema = z.object({
  name: z.string({ required_error: "teamdev.skill_name_required", invalid_type_error: "teamdev.skill_name_required" }).trim().min(1, "teamdev.skill_name_required").max(SKILL_LIMITS.name, "teamdev.skill_name_long"),
  category: z.preprocess(blankToEmpty, text(SKILL_LIMITS.category, "teamdev.skill_category_long")),
  description: z.preprocess(blankToEmpty, text(SKILL_LIMITS.description, "teamdev.skill_description_long")),
});
export type SkillInput = z.infer<typeof skillInputSchema>;

export const skillPatchSchema = z
  .object({
    name: z.string().trim().min(1, "teamdev.skill_name_required").max(SKILL_LIMITS.name, "teamdev.skill_name_long").optional(),
    category: text(SKILL_LIMITS.category, "teamdev.skill_category_long").optional(),
    description: text(SKILL_LIMITS.description, "teamdev.skill_description_long").optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "teamdev.no_change" });
export type SkillPatch = z.infer<typeof skillPatchSchema>;

export const personSkillSchema = z.object({
  skillId: z.string().trim().min(1).max(64),
  level: z.number({ invalid_type_error: "teamdev.level_invalid", required_error: "teamdev.level_invalid" }).int("teamdev.level_invalid").min(0, "teamdev.level_invalid").max(4, "teamdev.level_invalid"),
  note: z.preprocess(blankToEmpty, text(SKILL_LIMITS.note, "teamdev.note_long")),
  source: z.enum(["MANUAL", "SELF"], { errorMap: () => ({ message: "teamdev.source_invalid" }) }),
});
export type PersonSkillInput = z.infer<typeof personSkillSchema>;

const invalid = (path: string, key: string) => new ValidationError([{ path, message: key }]);

// ───────────────────────────────────────── the catalogue ─────────────────────────────────────────

export interface SkillDTO {
  id: string;
  name: string;
  category: string;
  description: string;
  archived: boolean;
}

const toSkill = (s: { id: string; name: string; category: string; description: string; archivedAt: Date | null }): SkillDTO => ({
  id: s.id,
  name: s.name,
  category: s.category,
  description: s.description,
  archived: s.archivedAt !== null,
});

/** The checklist, by category then name. Archived skills are listed only for those who keep the catalogue. */
export async function listSkills(actor: Actor, opts: { includeArchived?: boolean } = {}): Promise<SkillDTO[]> {
  const access = await devAccess(actor);
  const withArchived = opts.includeArchived === true && access.canManageLines;
  const rows = await db.skill.findMany({
    where: { organizationId: access.orgId, ...(withArchived ? {} : { archivedAt: null }) },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return rows.map(toSkill);
}

/** One free name among the skills that are not archived (letter case and spaces ignored). */
async function assertNameFree(orgId: string, name: string, exceptId?: string): Promise<void> {
  const same = await db.skill.findFirst({
    where: { organizationId: orgId, archivedAt: null, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (same) throw invalid("name", "teamdev.skill_name_taken");
}

export async function createSkill(actor: Actor, input: SkillInput): Promise<SkillDTO> {
  const access = await devAccess(actor);
  assertCanManageLines(access);
  await assertNameFree(access.orgId, input.name);
  const row = await db.$transaction(async (tx) => {
    // the count and the insert happen under one lock, so two requests cannot both take the hundredth place
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(41002::int, hashtext(${access.orgId}))`;
    if ((await tx.skill.count({ where: { organizationId: access.orgId } })) >= SKILL_LIMITS.maxSkills) throw invalid("name", "teamdev.skill_limit");
    return tx.skill.create({ data: { organizationId: access.orgId, name: input.name, category: input.category, description: input.description, createdById: actor.userId } });
  });
  return toSkill(row);
}

export async function updateSkill(actor: Actor, id: string, patch: SkillPatch): Promise<SkillDTO> {
  const access = await devAccess(actor);
  assertCanManageLines(access);
  const skill = await db.skill.findFirst({ where: { id, organizationId: access.orgId } });
  if (!skill) throw new NotFoundError("teamdev.not_found");
  if (patch.name !== undefined && patch.name.toLowerCase() !== skill.name.toLowerCase() && (patch.archived ?? skill.archivedAt !== null) === false) {
    await assertNameFree(access.orgId, patch.name, id);
  }
  // un-archiving a skill whose name another live skill took meanwhile
  if (patch.archived === false && skill.archivedAt) await assertNameFree(access.orgId, patch.name ?? skill.name, id);
  const row = await db.skill.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.archived !== undefined ? { archivedAt: patch.archived ? (skill.archivedAt ?? new Date()) : null } : {}),
    },
  });
  return toSkill(row);
}

// ───────────────────────────────────────── a person's levels ─────────────────────────────────────────

export interface LevelDTO {
  level: number;
  note: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PersonSkillRow {
  skill: SkillDTO;
  manual: LevelDTO | null;
  self: LevelDTO | null;
  /** Supervisor's level minus the person's own estimate; null when either is missing. */
  gap: number | null;
}

export interface HistoryDTO {
  id: string;
  skillId: string;
  source: SkillSource;
  oldLevel: number | null;
  newLevel: number;
  note: string;
  reason: string;
  changedBy: string;
  at: string;
}

async function namesOf(orgId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  // all-statuses: whoever entered a level is named on it even after they were suspended or offboarded
  const rows = await db.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: [...new Set(ids)] } }, select: { userId: true, user: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.userId, r.user.name]));
}

/**
 * The checklist of one person: every live skill (and an archived one the person has a level in), the supervisor's level and
 * the person's own estimate side by side. 404 for anybody who may not open this person.
 */
export async function loadPersonSkills(actor: Actor, userId: string): Promise<PersonSkillRow[]> {
  const access = await devAccess(actor);
  assertMayOpenPerson(access, userId);
  const [skills, levels] = await Promise.all([
    db.skill.findMany({ where: { organizationId: access.orgId }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.personSkill.findMany({ where: { organizationId: access.orgId, userId } }),
  ]);
  const names = await namesOf(access.orgId, levels.map((l) => l.updatedById));
  const dto = (l: (typeof levels)[number] | undefined): LevelDTO | null =>
    l ? { level: l.level, note: l.note, updatedAt: l.updatedAt.toISOString(), updatedBy: names.get(l.updatedById) ?? "" } : null;
  const rows: PersonSkillRow[] = [];
  for (const skill of skills) {
    const manual = levels.find((l) => l.skillId === skill.id && l.source === "MANUAL");
    const self = levels.find((l) => l.skillId === skill.id && l.source === "SELF");
    if (skill.archivedAt && !manual && !self) continue;
    rows.push({ skill: toSkill(skill), manual: dto(manual), self: dto(self), gap: skillGap(manual?.level, self?.level) });
  }
  return rows;
}

/** The history of one person's levels (every skill, or one), newest first. The person and their supervisors read it. */
export async function loadSkillHistory(actor: Actor, userId: string, skillId?: string): Promise<HistoryDTO[]> {
  const access = await devAccess(actor);
  assertMayOpenPerson(access, userId);
  const rows = await db.personSkillHistory.findMany({
    where: { organizationId: access.orgId, userId, ...(skillId ? { skillId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const names = await namesOf(access.orgId, rows.map((r) => r.changedById));
  return rows.map((r) => ({
    id: r.id,
    skillId: r.skillId,
    source: r.source,
    oldLevel: r.oldLevel,
    newLevel: r.newLevel,
    note: r.note,
    reason: r.reason,
    changedBy: names.get(r.changedById) ?? "",
    at: r.createdAt.toISOString(),
  }));
}

/**
 * Writes one level and its history row in one transaction. `reason` is set by the development plan's one-click confirm
 * (`goal:<id>`). A write that changes neither the level nor the note is a no-op (no history row).
 */
export async function writeLevel(
  access: Pick<DevAccess, "orgId">,
  by: string,
  userId: string,
  skillId: string,
  source: SkillSource,
  level: number,
  note: string,
  reason = "",
): Promise<{ changed: boolean }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(41003::int, hashtext(${`${userId}:${skillId}:${source}`}))`;
    const skill = await tx.skill.findFirst({ where: { id: skillId, organizationId: access.orgId }, select: { archivedAt: true } });
    if (!skill) throw new NotFoundError("teamdev.not_found");
    if (skill.archivedAt) throw invalid("skillId", "teamdev.skill_archived");
    const before = await tx.personSkill.findUnique({ where: { userId_skillId_source: { userId, skillId, source } } });
    if (before && before.level === level && before.note === note) return { changed: false };
    if (before) await tx.personSkill.update({ where: { id: before.id }, data: { level, note, updatedById: by } });
    else await tx.personSkill.create({ data: { organizationId: access.orgId, userId, skillId, source, level, note, updatedById: by } });
    await tx.personSkillHistory.create({
      data: { organizationId: access.orgId, userId, skillId, source, oldLevel: before ? before.level : null, newLevel: level, note, reason, changedById: by },
    });
    return { changed: true };
  });
}

/**
 * Sets one level. MANUAL: the owner, or a supervisor holding `people.review` for somebody in their subtree. SELF: the person,
 * about themselves only. An archived skill takes no new level.
 */
export async function setPersonSkill(actor: Actor, userId: string, input: PersonSkillInput): Promise<{ changed: boolean }> {
  const access = await devAccess(actor);
  if (input.source === "SELF") {
    if (!isSelf(access, userId)) {
      // somebody else's self estimate is theirs alone: 403 for a person the viewer reads, 404 for a stranger
      assertMayOpenPerson(access, userId);
      throw new ForbiddenError("teamdev.self_only");
    }
    if (!access.staff.has(userId)) throw new NotFoundError("teamdev.not_found");
  } else {
    assertMayEnterFor(access, userId);
  }
  return writeLevel(access, actor.userId, userId, input.skillId, input.source, input.level, input.note);
}

// ───────────────────────────────────────── the matrix (people × skills) ─────────────────────────────────────────

export interface MatrixCell {
  manual: number | null;
  self: number | null;
}

export interface SkillMatrix {
  skills: SkillDTO[];
  people: { userId: string; name: string; jobTitle: string | null }[];
  /** userId → skillId → cell. A missing cell is «—». */
  cells: Record<string, Record<string, MatrixCell>>;
}

/** The people the viewer reads (everybody for the owner, the subtree for a supervisor) against the live skills. 404 for everybody else. */
export async function loadSkillMatrix(actor: Actor): Promise<SkillMatrix> {
  const access = await devAccess(actor);
  if (!access.isOwner && !access.isSupervisor) throw new NotFoundError("teamdev.not_found");
  const ids = [...access.staff.keys()].filter((id) => (access.reach === null ? true : access.reach.has(id)));
  const [skills, levels] = await Promise.all([
    db.skill.findMany({ where: { organizationId: access.orgId, archivedAt: null }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.personSkill.findMany({ where: { organizationId: access.orgId, userId: { in: ids }, skill: { archivedAt: null } } }),
  ]);
  const cells: SkillMatrix["cells"] = {};
  for (const l of levels) {
    const row = (cells[l.userId] ??= {});
    const cell = (row[l.skillId] ??= { manual: null, self: null });
    if (l.source === "MANUAL") cell.manual = l.level;
    else cell.self = l.level;
  }
  const people = ids
    .map((id) => ({ userId: id, name: access.staff.get(id)!.name, jobTitle: access.staff.get(id)!.jobTitle }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return { skills: skills.map(toSkill), people, cells };
}

/** The matrix as a CSV (UTF-8 with a BOM, a cell that starts with = + - @ made safe): exactly what the viewer reads on screen. */
export function skillMatrixCsv(m: SkillMatrix, labels: { person: string; manual: string; self: string }): string {
  const head = [labels.person, ...m.skills.flatMap((s) => [`${s.name} — ${labels.manual}`, `${s.name} — ${labels.self}`])];
  const rows = m.people.map((p) => [p.name, ...m.skills.flatMap((s) => [m.cells[p.userId]?.[s.id]?.manual ?? "", m.cells[p.userId]?.[s.id]?.self ?? ""])]);
  return buildCsv([head, ...rows]);
}
