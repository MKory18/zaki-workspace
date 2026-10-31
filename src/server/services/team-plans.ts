import type { DevGoalStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertMayEnterFor, assertMayOpenPerson, devAccess, isSelf, mayEnterFor, type DevAccess } from "@/server/policy/team-development";
import { writeLevel } from "@/server/services/team-skills";
import { PLAN_LIMITS } from "@/lib/team-plans";

/**
 * «خطة التطوير» and «ملاحظات ١:١» of one person.
 *
 *  - The PLAN is a list of goals: a skill of the catalogue or a free title (≤ 120), a target level, actions (≤ 500), a due day, a
 *    status OPEN / DONE / CANCELLED. The owner and a supervisor holding `people.review` (for their subtree) write them. The PERSON
 *    adds only «اقتراح» items (`proposal`): a supervisor accepts one (it becomes a goal) or cancels it. A goal that is DONE and has a
 *    skill and a target level can set that skill's level in ONE CLICK, as a manual confirm by somebody who may enter levels; it is
 *    written to the skill history (reason `goal:<id>`) and only once.
 *  - The 1:1 NOTES are a private thread between the owner and the supervisors: the person reads only the notes marked «مشاركة».
 *    Notes are never edited or deleted; the author (or the owner) can share or unshare one.
 *  - The person reads their own plan always; a note only when it is shared.
 */

const blank = (v: unknown) => (v === undefined || v === null ? "" : v);
const invalid = (path: string, key: string) => new ValidationError([{ path, message: key }]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "teamdev.due_invalid").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "teamdev.due_invalid");
const level = z.number({ invalid_type_error: "teamdev.level_invalid" }).int("teamdev.level_invalid").min(0, "teamdev.level_invalid").max(4, "teamdev.level_invalid");

export const goalInputSchema = z.object({
  skillId: z.string().trim().min(1).max(64).nullable().optional(),
  title: z.preprocess(blank, z.string().trim().max(PLAN_LIMITS.title, "teamdev.goal_title_long")),
  targetLevel: level.nullable().optional(),
  actions: z.preprocess(blank, z.string().max(PLAN_LIMITS.actions, "teamdev.goal_actions_long")),
  dueDate: day.nullable().optional(),
});
export type GoalInput = z.infer<typeof goalInputSchema>;

export const goalPatchSchema = z
  .object({
    title: z.string().trim().max(PLAN_LIMITS.title, "teamdev.goal_title_long").optional(),
    targetLevel: level.nullable().optional(),
    actions: z.string().max(PLAN_LIMITS.actions, "teamdev.goal_actions_long").optional(),
    dueDate: day.nullable().optional(),
    status: z.enum(["OPEN", "DONE", "CANCELLED"], { errorMap: () => ({ message: "teamdev.status_invalid" }) }).optional(),
    /** A supervisor accepts a proposal: it becomes a goal. */
    accept: z.literal(true).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "teamdev.no_change" });
export type GoalPatch = z.infer<typeof goalPatchSchema>;

export const noteInputSchema = z.object({
  body: z.string({ required_error: "teamdev.note_required" }).trim().min(1, "teamdev.note_required").max(PLAN_LIMITS.note, "teamdev.note_long_1000"),
  shared: z.boolean().optional(),
});

export interface GoalDTO {
  id: string;
  userId: string;
  skillId: string | null;
  skillName: string | null;
  title: string;
  targetLevel: number | null;
  actions: string;
  dueDate: string | null;
  status: DevGoalStatus;
  /** A suggestion made by the person, not yet accepted. */
  proposal: boolean;
  /** The target level has already been written to the skill. */
  applied: boolean;
  createdBy: string;
  /** DONE, with a skill and a target level, not yet applied, and the viewer may enter levels: the one-click confirm is offered. */
  canApply: boolean;
  /** The viewer may edit it (a supervisor: any; the person: their own proposal). */
  canEdit: boolean;
}

async function subject(access: DevAccess, userId: string): Promise<void> {
  const p = access.staff.get(userId);
  if (!p || p.role === "OWNER") throw new NotFoundError("teamdev.not_found");
}

async function namesOf(orgId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  // all-statuses: a goal keeps the name of whoever wrote it
  const rows = await db.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: [...new Set(ids)] } }, select: { userId: true, user: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.userId, r.user.name]));
}

export async function listGoals(actor: Actor, userId: string): Promise<GoalDTO[]> {
  const access = await devAccess(actor);
  assertMayOpenPerson(access, userId);
  const rows = await db.devGoal.findMany({ where: { organizationId: access.orgId, userId }, orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }], include: { skill: { select: { name: true } } } });
  const names = await namesOf(access.orgId, rows.map((r) => r.createdById));
  const enter = mayEnterFor(access, userId);
  const self = isSelf(access, userId);
  return rows.map((g) => ({
    id: g.id,
    userId: g.userId,
    skillId: g.skillId,
    skillName: g.skill?.name ?? null,
    title: g.title,
    targetLevel: g.targetLevel,
    actions: g.actions,
    dueDate: g.dueDate ? g.dueDate.toISOString().slice(0, 10) : null,
    status: g.status,
    proposal: g.proposal,
    applied: g.appliedAt !== null,
    createdBy: names.get(g.createdById) ?? "",
    canApply: enter && g.status === "DONE" && g.skillId !== null && g.targetLevel !== null && g.appliedAt === null && !g.proposal,
    canEdit: enter || (self && g.proposal && g.status === "OPEN" && g.createdById === access.viewerId),
  }));
}

async function checkSkill(orgId: string, skillId: string | null | undefined): Promise<{ name: string } | null> {
  if (!skillId) return null;
  const skill = await db.skill.findFirst({ where: { id: skillId, organizationId: orgId }, select: { name: true, archivedAt: true } });
  if (!skill) throw new NotFoundError("teamdev.not_found");
  if (skill.archivedAt) throw invalid("skillId", "teamdev.skill_archived");
  return { name: skill.name };
}

/** A new goal. A supervisor writes a goal; the person about themselves writes a proposal («اقتراح»). */
export async function createGoal(actor: Actor, userId: string, input: GoalInput): Promise<GoalDTO> {
  const access = await devAccess(actor);
  await subject(access, userId);
  const self = isSelf(access, userId);
  if (self) assertMayOpenPerson(access, userId);
  else assertMayEnterFor(access, userId);
  const skill = await checkSkill(access.orgId, input.skillId);
  const title = input.title || skill?.name || "";
  if (!title) throw invalid("title", "teamdev.goal_title_required");
  if (input.targetLevel != null && !skill) throw invalid("targetLevel", "teamdev.goal_level_needs_skill");
  if ((await db.devGoal.count({ where: { organizationId: access.orgId, userId } })) >= PLAN_LIMITS.maxGoals) throw invalid("title", "teamdev.goal_limit");
  const row = await db.devGoal.create({
    data: {
      organizationId: access.orgId,
      userId,
      skillId: skill ? input.skillId! : null,
      title,
      targetLevel: input.targetLevel ?? null,
      actions: input.actions,
      dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
      proposal: self,
      createdById: actor.userId,
    },
  });
  return (await listGoals(actor, userId)).find((g) => g.id === row.id) as GoalDTO;
}

/**
 * Edits a goal. A supervisor (owner, or `people.review` in their subtree): everything, and `accept` turns a proposal into a goal.
 * The person: only their own proposal, while it is still a proposal (words, skill target) or to cancel it.
 */
export async function updateGoal(actor: Actor, goalId: string, patch: GoalPatch): Promise<GoalDTO> {
  const access = await devAccess(actor);
  const goal = await db.devGoal.findFirst({ where: { id: goalId, organizationId: access.orgId } });
  if (!goal) throw new NotFoundError("teamdev.not_found");
  assertMayOpenPerson(access, goal.userId);
  const enter = mayEnterFor(access, goal.userId);
  if (!enter) {
    const own = isSelf(access, goal.userId) && goal.proposal && goal.status === "OPEN" && goal.createdById === access.viewerId;
    if (!own) {
      if (isSelf(access, goal.userId) || access.reach?.has(goal.userId) || access.isOwner) throw new ForbiddenError("teamdev.review_denied");
      throw new NotFoundError("teamdev.not_found");
    }
    // the person: words and a cancel, never «accept», never DONE
    if (patch.accept || (patch.status && patch.status !== "CANCELLED")) throw new ForbiddenError("teamdev.review_denied");
  }
  if (patch.targetLevel != null && !goal.skillId) throw invalid("targetLevel", "teamdev.goal_level_needs_skill");
  if (patch.title !== undefined && patch.title === "") throw invalid("title", "teamdev.goal_title_required");
  if (goal.appliedAt && (patch.targetLevel !== undefined || patch.status === "OPEN")) throw invalid("status", "teamdev.goal_applied");
  await db.devGoal.update({
    where: { id: goalId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.targetLevel !== undefined ? { targetLevel: patch.targetLevel } : {}),
      ...(patch.actions !== undefined ? { actions: patch.actions } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ? new Date(`${patch.dueDate}T00:00:00Z`) : null } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.accept && goal.proposal ? { proposal: false } : {}),
    },
  });
  return (await listGoals(actor, goal.userId)).find((g) => g.id === goalId) as GoalDTO;
}

/**
 * The one-click confirm: a DONE goal with a skill and a target level writes that level as the supervisor's (MANUAL) level, with
 * the history row `goal:<id>`. Needs the right to enter levels for that person; works once; refuses an archived skill.
 */
export async function applyGoal(actor: Actor, goalId: string): Promise<{ changed: boolean }> {
  const access = await devAccess(actor);
  const goal = await db.devGoal.findFirst({ where: { id: goalId, organizationId: access.orgId } });
  if (!goal) throw new NotFoundError("teamdev.not_found");
  assertMayEnterFor(access, goal.userId);
  if (goal.status !== "DONE" || !goal.skillId || goal.targetLevel === null || goal.proposal) throw invalid("status", "teamdev.goal_not_applicable");
  // claimed first, so two clicks at once write once; given back if the write is refused
  const claim = await db.devGoal.updateMany({ where: { id: goal.id, appliedAt: null }, data: { appliedAt: new Date() } });
  if (claim.count !== 1) throw invalid("status", "teamdev.goal_applied");
  try {
    const current = await db.personSkill.findUnique({ where: { userId_skillId_source: { userId: goal.userId, skillId: goal.skillId, source: "MANUAL" } }, select: { note: true } });
    const out = await writeLevel(access, actor.userId, goal.userId, goal.skillId, "MANUAL", goal.targetLevel, current?.note ?? "", `goal:${goal.id}`);
    await audit("team.goal_applied", { actorId: actor.userId, orgId: access.orgId, target: goal.userId, meta: { goal: goal.id, skill: goal.skillId, level: goal.targetLevel } });
    return out;
  } catch (err) {
    await db.devGoal.updateMany({ where: { id: goal.id }, data: { appliedAt: null } });
    throw err;
  }
}

// ───────────────────────────────────────── the 1:1 notes ─────────────────────────────────────────

export interface NoteDTO {
  id: string;
  userId: string;
  author: string;
  body: string;
  shared: boolean;
  createdAt: string;
  mine: boolean;
  /** The viewer may share or unshare it (its author, or the owner). */
  canShare: boolean;
}

/** The thread: owner and supervisors read every note; the person reads only the notes marked «مشاركة». */
export async function listNotes(actor: Actor, userId: string): Promise<NoteDTO[]> {
  const access = await devAccess(actor);
  assertMayOpenPerson(access, userId);
  const self = isSelf(access, userId);
  const rows = await db.reviewNote.findMany({ where: { organizationId: access.orgId, userId, ...(self ? { shared: true } : {}) }, orderBy: { createdAt: "desc" }, take: 300 });
  const names = await namesOf(access.orgId, rows.map((r) => r.authorId));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    author: names.get(r.authorId) ?? "",
    body: r.body,
    shared: r.shared,
    createdAt: r.createdAt.toISOString(),
    mine: r.authorId === access.viewerId,
    canShare: !self && (r.authorId === access.viewerId || access.isOwner),
  }));
}

export async function addNote(actor: Actor, userId: string, input: z.infer<typeof noteInputSchema>): Promise<NoteDTO> {
  const access = await devAccess(actor);
  assertMayEnterFor(access, userId);
  await subject(access, userId);
  const row = await db.reviewNote.create({ data: { organizationId: access.orgId, userId, authorId: actor.userId, body: input.body, shared: input.shared === true } });
  return (await listNotes(actor, userId)).find((n) => n.id === row.id) as NoteDTO;
}

export async function setNoteShared(actor: Actor, noteId: string, shared: boolean): Promise<NoteDTO> {
  const access = await devAccess(actor);
  const note = await db.reviewNote.findFirst({ where: { id: noteId, organizationId: access.orgId } });
  if (!note) throw new NotFoundError("teamdev.not_found");
  assertMayEnterFor(access, note.userId);
  if (note.authorId !== actor.userId && !access.isOwner) throw new NotFoundError("teamdev.not_found");
  await db.reviewNote.update({ where: { id: noteId }, data: { shared } });
  return (await listNotes(actor, note.userId)).find((n) => n.id === noteId) as NoteDTO;
}
