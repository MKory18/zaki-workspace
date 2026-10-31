import { Prisma, type ReviewLight, type ReviewStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertMayEnterFor, assertMayOpenPerson, devAccess, isSelf, type DevAccess } from "@/server/policy/team-development";
import { orgTimeZone } from "@/server/services/org-day";
import { ensureCriteria } from "@/server/services/team-criteria";
import { NEXT_STATUS, REVIEW_LIMITS, countedReviews, isOpenStatus, latestPerReviewer, readRatings, sharedReviews, type ReviewRow } from "@/lib/team-reviews";
import { LIGHTS, isFuture, parsePeriod } from "@/lib/team-score";
import { dayKeyOf } from "@/lib/owner-board";

/**
 * «التقييمات» — what the owner and the supervisors write about a person for a period.
 *
 *  - WHO WRITES: the owner about anybody (an ACTIVE staff member who is not an OWNER, and never himself); a supervisor holding
 *    `people.review` about the people of their subtree. Outside that: 404. A supervisor without the switch: 403.
 *  - ONE LIVE REVIEW per reviewer, person and period. It is updated while DRAFT or SUBMITTED. A SHARED one is LOCKED: saving again
 *    asks for `newVersion: true`, which starts version N+1 as a DRAFT (the old one stays, and stays what the person saw).
 *  - STATUS: DRAFT → SUBMITTED → SHARED, by the author (or the owner). The person reads strengths, improvement, ratings and the
 *    light ONLY of a SHARED review; the private note is never theirs. The score counts SUBMITTED and SHARED reviews.
 *  - Nothing is deleted. Submitting and sharing are audited.
 */

const text = z.string({ invalid_type_error: "teamdev.review_text_long" }).max(REVIEW_LIMITS.text, "teamdev.review_text_long");
const blank = (v: unknown) => (v === undefined || v === null ? "" : v);

export const reviewInputSchema = z.object({
  period: z.string({ required_error: "teamdev.period_invalid" }),
  ratings: z.record(z.string().max(64), z.number({ invalid_type_error: "teamdev.rating_invalid" }).int("teamdev.rating_invalid").min(1, "teamdev.rating_invalid").max(5, "teamdev.rating_invalid")).default({}),
  light: z.enum(LIGHTS as unknown as [string, ...string[]], { errorMap: () => ({ message: "teamdev.light_invalid" }) }).nullable().optional(),
  strengths: z.preprocess(blank, text),
  improvement: z.preprocess(blank, text),
  privateNote: z.preprocess(blank, text),
  /** Needed to edit a SHARED review: starts a new version instead of changing it. */
  newVersion: z.boolean().optional(),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const reviewStatusSchema = z.object({ status: z.enum(["SUBMITTED", "SHARED"], { errorMap: () => ({ message: "teamdev.status_invalid" }) }) });

const invalid = (path: string, key: string) => new ValidationError([{ path, message: key }]);

export interface ReviewDTO {
  id: string;
  userId: string;
  reviewerId: string;
  reviewerName: string;
  period: string;
  version: number;
  status: ReviewStatus;
  ratings: Record<string, number>;
  light: ReviewLight | null;
  strengths: string;
  improvement: string;
  /** Present for reviewers only: absent (not just empty) when the person reads their own review. */
  privateNote?: string;
  updatedAt: string;
  submittedAt: string | null;
  sharedAt: string | null;
  /** The viewer wrote it. */
  mine: boolean;
  /** The viewer may change it in place (the author, while it is DRAFT or SUBMITTED). */
  editable: boolean;
  /** Is this the reviewer's live (latest) version of that period? */
  live: boolean;
}

type Row = Prisma.ReviewGetPayload<Record<string, never>>;

const asRow = (r: Row): ReviewRow & Row => r as unknown as ReviewRow & Row;

async function namesOf(orgId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  // all-statuses: a review keeps the name of its author even after they were suspended or offboarded
  const rows = await db.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: [...new Set(ids)] } }, select: { userId: true, user: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.userId, r.user.name]));
}

/** The person a review may be about: ACTIVE staff, not an OWNER, not the viewer. 404 otherwise. */
async function reviewSubject(access: DevAccess, userId: string): Promise<void> {
  const p = access.staff.get(userId);
  if (!p || p.role === "OWNER") throw new NotFoundError("teamdev.not_found");
}

function toDto(r: Row, viewer: string, names: Map<string, string>, reviewerView: boolean, liveIds: Set<string>): ReviewDTO {
  return {
    id: r.id,
    userId: r.userId,
    reviewerId: r.reviewerId,
    reviewerName: names.get(r.reviewerId) ?? "",
    period: r.period,
    version: r.version,
    status: r.status,
    ratings: readRatings(r.ratings),
    light: r.light,
    strengths: r.strengths,
    improvement: r.improvement,
    ...(reviewerView ? { privateNote: r.privateNote } : {}),
    updatedAt: r.updatedAt.toISOString(),
    submittedAt: r.submittedAt?.toISOString() ?? null,
    sharedAt: r.sharedAt?.toISOString() ?? null,
    mine: r.reviewerId === viewer,
    editable: r.reviewerId === viewer && isOpenStatus(r.status),
    live: liveIds.has(r.id),
  };
}

/**
 * The reviews of one person (optionally one period). The PERSON reads only the SHARED ones (their latest shared version per reviewer),
 * without the private note — the note is not even a key of what is returned. The owner and the supervisors read every version.
 */
export async function listReviews(actor: Actor, userId: string, period?: string): Promise<ReviewDTO[]> {
  const access = await devAccess(actor);
  assertMayOpenPerson(access, userId);
  if (period !== undefined && !parsePeriod(period)) throw invalid("period", "teamdev.period_invalid");
  const rows = await db.review.findMany({ where: { organizationId: access.orgId, userId, ...(period ? { period } : {}) }, orderBy: [{ period: "desc" }, { reviewerId: "asc" }, { version: "desc" }] });
  const self = isSelf(access, userId);
  const visible = self ? sharedReviews(rows.map(asRow)) : rows.map(asRow);
  const names = await namesOf(access.orgId, visible.map((r) => r.reviewerId));
  const live = new Set(latestPerReviewer(rows.map(asRow)).map((r) => r.id));
  const sharedLive = new Set(visible.map((r) => r.id));
  return visible.map((r) => toDto(r, access.viewerId, names, !self, self ? sharedLive : live));
}

export interface SavedReview {
  review: ReviewDTO;
  /** true: a new version was started because the last one was SHARED. */
  newVersion: boolean;
}

async function checkRatings(orgId: string, ratings: Record<string, number>, keep: Record<string, number>): Promise<void> {
  const keys = Object.keys(ratings);
  if (keys.length === 0) return;
  await ensureCriteria(orgId);
  const criteria = await db.reviewCriterion.findMany({ where: { organizationId: orgId, id: { in: keys } }, select: { id: true, archivedAt: true } });
  const known = new Map(criteria.map((c) => [c.id, c.archivedAt === null]));
  for (const key of keys) {
    // a criterion of this company; an archived one only where the review already had it (an old review keeps its ratings)
    if (!known.has(key)) throw invalid("ratings", "teamdev.criterion_unknown");
    if (known.get(key) === false && !(key in keep)) throw invalid("ratings", "teamdev.criterion_archived");
  }
}

/** Creates or updates the viewer's own review of a person for a period (see the header for the rules). */
export async function saveReview(actor: Actor, userId: string, input: ReviewInput): Promise<SavedReview> {
  const access = await devAccess(actor);
  assertMayEnterFor(access, userId);
  await reviewSubject(access, userId);
  const period = parsePeriod(input.period);
  if (!period) throw invalid("period", "teamdev.period_invalid");
  const tz = await orgTimeZone(access.orgId);
  const now = new Date();
  if (isFuture(period, dayKeyOf(now, tz))) throw invalid("period", "teamdev.period_future");

  const light = (input.light ?? null) as ReviewLight | null;
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(41005::int, hashtext(${`${userId}:${actor.userId}:${period.key}`}))`;
    const mine = await tx.review.findMany({ where: { organizationId: access.orgId, userId, reviewerId: actor.userId, period: period.key }, orderBy: { version: "desc" }, take: 1 });
    const last = mine[0];
    const keep = last ? readRatings(last.ratings) : {};
    await checkRatings(access.orgId, input.ratings, keep);
    const body = { ratings: input.ratings as Prisma.InputJsonValue, light, strengths: input.strengths, improvement: input.improvement, privateNote: input.privateNote };
    if (!last) {
      return { row: await tx.review.create({ data: { organizationId: access.orgId, userId, reviewerId: actor.userId, period: period.key, version: 1, ...body } }), newVersion: false };
    }
    if (isOpenStatus(last.status)) {
      return { row: await tx.review.update({ where: { id: last.id }, data: body }), newVersion: false };
    }
    // SHARED: locked. A correction is a new version, and only when it is asked for.
    if (!input.newVersion) throw new ForbiddenError("teamdev.review_locked");
    return { row: await tx.review.create({ data: { organizationId: access.orgId, userId, reviewerId: actor.userId, period: period.key, version: last.version + 1, ...body } }), newVersion: true };
  });
  const names = await namesOf(access.orgId, [actor.userId]);
  return { review: toDto(result.row, actor.userId, names, true, new Set([result.row.id])), newVersion: result.newVersion };
}

/** DRAFT → SUBMITTED → SHARED, one step at a time, by the author or the owner. Submitting needs at least one rating. Audited. */
export async function advanceReview(actor: Actor, reviewId: string, to: "SUBMITTED" | "SHARED"): Promise<ReviewDTO> {
  const access = await devAccess(actor);
  const found = await db.review.findFirst({ where: { id: reviewId, organizationId: access.orgId } });
  // a review about somebody the viewer may not enter things for does not exist for them
  if (!found) throw new NotFoundError("teamdev.not_found");
  assertMayEnterFor(access, found.userId);
  if (found.reviewerId !== actor.userId && !access.isOwner) throw new NotFoundError("teamdev.not_found");
  if (NEXT_STATUS[found.status] !== to) throw new ForbiddenError("teamdev.status_order");
  if (to === "SUBMITTED" && Object.keys(readRatings(found.ratings)).length === 0) throw invalid("ratings", "teamdev.review_empty");
  const now = new Date();
  // the status moves only from the one it was read in: two clicks at once make one change
  const { count } = await db.review.updateMany({
    where: { id: found.id, status: found.status },
    data: to === "SUBMITTED" ? { status: "SUBMITTED", submittedAt: now } : { status: "SHARED", sharedAt: now },
  });
  if (count !== 1) throw new ForbiddenError("teamdev.status_order");
  const row = await db.review.findUniqueOrThrow({ where: { id: found.id } });
  await audit(to === "SHARED" ? "team.review_shared" : "team.review_submitted", { actorId: actor.userId, orgId: access.orgId, target: found.userId, meta: { review: found.id, period: found.period, version: found.version } });
  const names = await namesOf(access.orgId, [row.reviewerId]);
  return toDto(row, actor.userId, names, true, new Set([row.id]));
}

/** What the score needs: the counted reviews (SUBMITTED / SHARED, one per reviewer) of the given people for a period. */
export async function countedReviewsFor(orgId: string, userIds: readonly string[], period: string, opts: { sharedOnly?: boolean } = {}) {
  if (!userIds.length) return [];
  const rows = await db.review.findMany({
    where: { organizationId: orgId, userId: { in: [...userIds] }, period, status: opts.sharedOnly ? "SHARED" : { in: ["SUBMITTED", "SHARED"] } },
  });
  return (opts.sharedOnly ? sharedReviews(rows.map(asRow)) : countedReviews(rows.map(asRow))) as Row[];
}
