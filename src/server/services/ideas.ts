import { Prisma } from "@prisma/client";
import type { OrgRole } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, requireUser } from "@/server/auth";
import type { OrgAccessContext } from "@/server/auth";
import { canManageOrg } from "@/server/services/orgs";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { assertCanWrite, assertNotGuest } from "@/server/services/guest-guard";
import type { ActorContext } from "@/server/services/tasks";
import { createTask } from "@/server/services/tasks";
import type { DbClient } from "@/server/db";

/**
 * Membership context resolved from the idea's own org (shared by API routes). Only an ACTIVE member
 * of that org gets one: somebody suspended or offboarded there is "not a member", even when they
 * are active in another organization of theirs. Ideas are the team's own, so an external partner
 * (guest) is refused with `guest.no_access` too, including for an idea they wrote before they were
 * made a guest - the door every per-idea route goes through (edit, delete, vote, convert).
 */
export async function ideaAccessCtx(ideaId: string): Promise<OrgAccessContext> {
  const user = await requireUser();
  const idea = await db.idea.findUnique({
    where: { id: ideaId },
    select: { orgId: true },
  });
  if (!idea) throw new ForbiddenError("idea.not_found");
  const membership = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: idea.orgId, userId: user.id } },
    select: { role: true, status: true },
  });
  if (!membership || membership.status !== "ACTIVE") throw new ForbiddenError("not_org_member");
  assertNotGuest({ orgRole: membership.role });
  return { orgId: idea.orgId, orgRole: membership.role, userId: user.id };
}

export type IdeaStatus = "NEW" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED";

/**
 * Allowed status transitions. Real review discipline:
 * NEW must go through review before accept/reject; rejected ideas may go
 * back to review; ACCEPTED is terminal through this map (needs admin edit).
 */
const TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
  NEW: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["ACCEPTED", "REJECTED"],
  REJECTED: ["UNDER_REVIEW"],
  ACCEPTED: [],
};

/** Pure transition check (unit-tested). */
export function canTransition(from: IdeaStatus, to: IdeaStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const IDEA_INCLUDE = {
  creator: { select: { id: true, name: true, jobTitle: true } },
  votes: { select: { userId: true } },
} satisfies Prisma.IdeaInclude;

export interface IdeaDTO {
  id: string;
  title: string;
  description: string | null;
  status: IdeaStatus;
  taskId: string | null;
  createdAt: Date;
  updatedAt: Date;
  creatorId: string;
  creatorName: string;
  creatorJobTitle: string | null;
  voteCount: number;
  votedByMe: boolean;
  orgKeyPrefix: string;
}

interface Row {
  id: string;
  title: string;
  description: string | null;
  status: IdeaStatus;
  taskId: string | null;
  createdAt: Date;
  updatedAt: Date;
  creatorId: string;
  creator: { id: string; name: string; jobTitle: string | null };
  votes: { userId: string }[];
  organization: { keyPrefix: string };
}

function toDTO(row: Row, viewerId: string, external = false): IdeaDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    taskId: row.taskId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    creatorId: row.creator.id,
    creatorName: row.creator.name,
    // the staff directory is closed to external partners: no job titles for them
    creatorJobTitle: external ? null : row.creator.jobTitle,
    voteCount: row.votes.length,
    votedByMe: row.votes.some((v) => v.userId === viewerId),
    orgKeyPrefix: row.organization.keyPrefix,
  };
}

export interface ListIdeasFilters {
  status?: IdeaStatus;
  mine?: boolean;
  viewerId: string;
  /** The viewer is an external partner (org GUEST): the list is not shared with them at all (`guest.no_access`). */
  external?: boolean;
}

export async function listIdeas(orgId: string, filters: ListIdeasFilters): Promise<IdeaDTO[]> {
  // The route and the page refuse a guest first; this is the same rule held where the data is, so a
  // new caller that forgets it still hands a partner nothing (every idea names its author).
  if (filters.external === true) throw new ForbiddenError("guest.no_access");
  const where: Prisma.IdeaWhereInput = { orgId };
  if (filters.status) where.status = filters.status;
  if (filters.mine) where.creatorId = filters.viewerId;
  const rows = await db.idea.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
    include: {
      ...IDEA_INCLUDE,
      organization: { select: { keyPrefix: true } },
    },
  });
  return rows.map((row) => toDTO(row, filters.viewerId, filters.external === true));
}

export interface CreateIdeaInput {
  title: string;
  description?: string | null;
}

export async function createIdea(orgId: string, actor: ActorContext, input: CreateIdeaInput): Promise<IdeaDTO> {
  const row = await db.idea.create({
    data: {
      orgId,
      creatorId: actor.userId,
      title: input.title,
      description: input.description ?? null,
    },
    include: { ...IDEA_INCLUDE, organization: { select: { keyPrefix: true } } },
  });
  return toDTO(row, actor.userId);
}

async function assertIdeaScope(ideaId: string, orgId: string, client: DbClient): Promise<
  { id: string; status: IdeaStatus; creatorId: string; taskId: string | null }
> {
  const row = await client.idea.findFirst({
    where: { id: ideaId, orgId },
    select: { id: true, status: true, creatorId: true, taskId: true },
  });
  if (!row) throw new NotFoundError("idea.not_found");
  return row;
}

export async function updateIdea(
  orgId: string,
  actor: ActorContext,
  orgRole: OrgRole,
  ideaId: string,
  data: { title?: string; description?: string | null; status?: IdeaStatus },
): Promise<IdeaDTO> {
  // an external partner never writes, not even on an idea they wrote before they were made a guest
  assertCanWrite({ orgRole });
  return db.$transaction(async (tx) => {
    const idea = await assertIdeaScope(ideaId, orgId, tx);
    const updateData: Prisma.IdeaUpdateInput = {};
    // text edits: author or admins
    if (data.title !== undefined) {
      if (idea.creatorId !== actor.userId && !canManageOrg(orgRole)) {
        throw new ForbiddenError("idea.not_owner");
      }
      if (!data.title.trim()) throw new ForbiddenError("idea.bad_title");
      updateData.title = data.title.trim();
    }
    if (data.description !== undefined) {
      if (idea.creatorId !== actor.userId && !canManageOrg(orgRole)) {
        throw new ForbiddenError("idea.not_owner");
      }
      updateData.description = data.description;
    }
    // status changes: ADMIN+ only, and must respect the transition map
    if (data.status !== undefined && data.status !== idea.status) {
      if (!canManageOrg(orgRole)) throw new ForbiddenError("insufficient_role");
      if (!canTransition(idea.status, data.status)) {
        throw new ForbiddenError(`idea.invalid_transition:${idea.status}->${data.status}`);
      }
      updateData.status = data.status;
    }
    const row = await tx.idea.update({
      where: { id: ideaId },
      data: updateData,
      include: { ...IDEA_INCLUDE, organization: { select: { keyPrefix: true } } },
    });
    return toDTO(row, actor.userId);
  });
}

export async function deleteIdea(
  orgId: string,
  actor: ActorContext,
  orgRole: OrgRole,
  ideaId: string,
): Promise<void> {
  assertCanWrite({ orgRole });
  const idea = await assertIdeaScope(ideaId, orgId, db);
  if (idea.creatorId !== actor.userId && !canManageOrg(orgRole)) {
    throw new ForbiddenError("idea.not_owner");
  }
  await db.idea.delete({ where: { id: ideaId } });
}

/** Toggle the caller's upvote. Org GUESTs are read-only. */
export async function toggleIdeaVote(
  orgId: string,
  actor: ActorContext,
  ideaId: string,
): Promise<{ voted: boolean }> {
  const idea = await assertIdeaScope(ideaId, orgId, db);
  const existing = await db.ideaVote.findUnique({
    where: { ideaId_userId: { ideaId: idea.id, userId: actor.userId } },
    select: { id: true },
  });
  if (existing) {
    await db.ideaVote.delete({ where: { id: existing.id } });
    return { voted: false };
  }
  try {
    await db.ideaVote.create({
      data: { orgId, ideaId: idea.id, userId: actor.userId },
    });
    return { voted: true };
  } catch (err) {
    if (
      typeof err === "object" && err !== null && "code" in err &&
      String(err.code) === "P2002"
    ) {
      return { voted: true }; // concurrent double-vote: treat as idempotent
    }
    throw err;
  }
}

/** Converts an accepted/reviewed idea into a real task through the task service. */
export async function convertIdeaToTask(
  orgId: string,
  actor: ActorContext,
  orgRole: OrgRole,
  ideaId: string,
  target: { workspaceId: string; projectId: string; boardId: string },
): Promise<{ idea: IdeaDTO; taskId: string }> {
  assertCanWrite({ orgRole });
  const idea = await assertIdeaScope(ideaId, orgId, db);
  if (idea.taskId) throw new ForbiddenError("idea.already_converted");
  if (!canManageOrg(orgRole) && idea.creatorId !== actor.userId) {
    throw new ForbiddenError("idea.not_owner");
  }
  // the caller must be able to open the TARGET workspace (the same rule every view
  // uses); a workspace that does not exist or is closed to them is refused alike,
  // so the answer never reveals whether an id exists
  const reachable = await accessibleWorkspaceIds(actor.userId);
  if (!reachable.includes(target.workspaceId)) throw new ForbiddenError("not_workspace_member");
  // through the single task service so counter/done/labels rules all apply
  const full = await db.idea.findUniqueOrThrow({
    where: { id: idea.id },
    select: { title: true, description: true },
  });
  const task = await createTask(actor, {
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    boardId: target.boardId,
    title: full.title,
    description: full.description ?? undefined,
  });
  const row = await db.idea.update({
    where: { id: idea.id },
    data: { status: "ACCEPTED", taskId: task.id },
    include: { ...IDEA_INCLUDE, organization: { select: { keyPrefix: true } } },
  });
  return { idea: toDTO(row, actor.userId), taskId: task.id };
}
