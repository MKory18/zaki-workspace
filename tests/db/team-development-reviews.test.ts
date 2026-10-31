import "./scoping-react";
import { describe, expect, it, vi } from "vitest";

// the pages call notFound(); no running Next app is needed here
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import type { Prisma } from "@prisma/client";
import * as peopleRoute from "@/app/api/team-development/people/route";
import * as peopleCsvRoute from "@/app/api/team-development/people/csv/route";
import * as scoreRoute from "@/app/api/team-development/people/[id]/score/route";
import * as reviewsRoute from "@/app/api/team-development/people/[id]/reviews/route";
import * as reviewRoute from "@/app/api/team-development/reviews/[id]/route";
import * as goalsRoute from "@/app/api/team-development/people/[id]/goals/route";
import * as goalRoute from "@/app/api/team-development/goals/[id]/route";
import * as applyRoute from "@/app/api/team-development/goals/[id]/apply/route";
import * as notesRoute from "@/app/api/team-development/people/[id]/notes/route";
import * as noteRoute from "@/app/api/team-development/notes/[id]/route";
import * as criteriaRoute from "@/app/api/team-development/criteria/route";
import * as criterionRoute from "@/app/api/team-development/criteria/[id]/route";
import * as weightsRoute from "@/app/api/team-development/weights/route";
import * as skillsRoute from "@/app/api/team-development/skills/route";
import * as personSkillsRoute from "@/app/api/team-development/people/[id]/skills/route";
import PersonPage from "@/app/(app)/development/people/[id]/page";
import DevelopmentPage from "@/app/(app)/development/page";
import SettingsPage from "@/app/(app)/development/settings/page";
import { withFeature } from "@/lib/features";
import { requireActor } from "@/server/policy/actor";
import { boardAccess } from "@/server/policy/board";
import { loadOverview } from "@/server/services/owner-board";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { html } from "./today-helpers";

/**
 * «الأداء والتطوير», part 2 — the score, the reviews, the development plan, the 1:1 notes, the criteria and the weights, against a
 * real PostgreSQL. The access matrix is pinned for every role against every resource; the privacy of what the person may not read
 * (a private note, an unshared review, a score built on it) is pinned by looking at the raw answers, not only at the screens.
 */

const get = (handler: unknown, params: Record<string, string> = {}, query = "") => call(handler, { url: `http://localhost/api/team-development${query}`, params });
const send = (handler: unknown, method: string, body: unknown, params: Record<string, string> = {}) => call(handler, { method, body, params });
const as = (id: string) => loginAs(id);
const grant = (orgId: string, userId: string, data: { capabilities?: string[]; revokedCapabilities?: string[] }) => db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data });
const under = (orgId: string, userId: string, managerId: string | null) => db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: { managerId } });
const at = (iso: string) => new Date(iso);
const PERIOD = "2026-10";

/**   owner ── sup (people.review) ── r1, r2        owner ── sup2 ── x        supNo (no switch) ── y        a partner, a guest, another company */
async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const mk = (name: string, role: "LEAD" | "MEMBER" | "OWNER" = "MEMBER") => makeUser({ orgId, role, name });
  const sup = await mk("مسؤول يقيّم", "LEAD");
  const supNo = await mk("مسؤول بلا تقييم", "LEAD");
  const sup2 = await mk("مسؤول آخر");
  const r1 = await mk("ا موظف واحد");
  const r2 = await mk("ب موظف اثنان");
  const x = await mk("ج موظف آخر");
  const y = await mk("د موظف الثاني");
  const partner = await mk("شريك", "OWNER");
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: partner.id } }, data: { primaryOwner: false } });
  for (const [u, m] of [[sup, t.owner], [supNo, t.owner], [sup2, t.owner], [r1, sup], [r2, sup], [x, sup2], [y, supNo]] as const) await under(orgId, u.id, m.id);
  await grant(orgId, sup.id, { capabilities: ["people.review"] });
  const outsider = await makeTeam();
  const ws = await makeWorkspace(orgId, [{ userId: r1.id }, { userId: r2.id }, { userId: x.id }, { userId: y.id }]);
  const p = await makeProject(ws.id);
  const done = (assigneeId: string, completedAt: string, dueDate: string | null = null) =>
    makeTask({ orgId, workspaceId: ws.id, projectId: p.project.id, boardId: p.board.id, columnId: p.done.id, creatorId: t.owner.id, assigneeId, dueDate: dueDate ? at(dueDate) : null, completedAt: at(completedAt) });
  const criteria = async () => (await get(criteriaRoute.GET, {}, "/criteria?all=1")).json?.["criteria"] as { id: string; code: string; name: string; archived: boolean }[];
  return { ...t, sup, supNo, sup2, r1, r2, x, y, partner, outsider: outsider.owner, orgId, ws, p, done, criteria };
}
type World = Awaited<ReturnType<typeof world>>;

const setFeature = async (w: World, on: boolean) => {
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.orgId } });
  await db.organization.update({ where: { id: w.orgId }, data: { settings: withFeature(org.settings, "teamDevelopment", on) as Prisma.InputJsonValue } });
};
const mkSkill = (w: World, name: string, archivedAt: Date | null = null) => db.skill.create({ data: { organizationId: w.orgId, name, createdById: w.owner.id, archivedAt } });
/** The owner's id-keyed ratings for the first two criteria. */
async function ratingsOf(w: World, values: number[]): Promise<Record<string, number>> {
  await as(w.owner.id);
  const list = await w.criteria();
  return Object.fromEntries(values.map((v, i) => [list[i]!.id, v]));
}
const review = (w: World, viewer: string, userId: string, body: Record<string, unknown> = {}) => as(viewer).then(() => send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: {}, ...body }, { id: userId }));
const advance = (viewer: string, id: string, status: string) => as(viewer).then(() => send(reviewRoute.PATCH, "PATCH", { status }, { id }));

// ───────────────────────────────────────── the access matrix ─────────────────────────────────────────

describe("the access matrix: every role against every resource about one person (r1)", () => {
  it("READ: the person, their supervisor, the owner and a partner read; a peer, another supervisor, an outsider and a guest get 404 on every resource", async () => {
    const w = await world();
    await mkSkill(w, "مهارة");
    const resources: [string, unknown, Record<string, string>, string?][] = [
      ["skills", personSkillsRoute.GET, { id: w.r1.id }],
      ["reviews", reviewsRoute.GET, { id: w.r1.id }],
      ["goals", goalsRoute.GET, { id: w.r1.id }],
      ["notes", notesRoute.GET, { id: w.r1.id }],
      ["score", scoreRoute.GET, { id: w.r1.id }, `/score?period=${PERIOD}`],
    ];
    const expected: [string, string, number][] = [
      ["owner", w.owner.id, 200],
      ["partner", w.partner.id, 200],
      ["supervisor with people.review", w.sup.id, 200],
      ["self", w.r1.id, 200],
      ["peer", w.r2.id, 404],
      ["supervisor of another subtree", w.sup2.id, 404],
      ["supervisor without people.review of another subtree", w.supNo.id, 404],
      ["guest", w.guest.id, 404],
      ["another company's owner", w.outsider.id, 404],
    ];
    for (const [label, id, status] of expected) {
      await as(id);
      for (const [name, handler, params, query] of resources) expect((await get(handler, params, query ?? "")).status, `${label} / ${name}`).toBe(status);
    }
  });

  it("A supervisor without `people.review` READS the subtree and cannot write anything about it", async () => {
    const w = await world();
    const skill = await mkSkill(w, "قراءة");
    await as(w.supNo.id);
    for (const [handler, params] of [[personSkillsRoute.GET, { id: w.y.id }], [reviewsRoute.GET, { id: w.y.id }], [goalsRoute.GET, { id: w.y.id }], [notesRoute.GET, { id: w.y.id }]] as const) expect((await get(handler, params)).status).toBe(200);
    expect((await get(scoreRoute.GET, { id: w.y.id }, `/score?period=${PERIOD}`)).status).toBe(200);
    for (const res of [
      await send(personSkillsRoute.PUT, "PUT", { skillId: skill.id, source: "MANUAL", level: 2 }, { id: w.y.id }),
      await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: {} }, { id: w.y.id }),
      await send(goalsRoute.POST, "POST", { title: "هدف" }, { id: w.y.id }),
      await send(notesRoute.POST, "POST", { body: "ملاحظة" }, { id: w.y.id }),
    ]) expect(res.status).toBe(403);
  });

  it("WRITE: the owner and a partner write about anybody; a supervisor with the switch about their subtree only; the person only their own estimate and proposals; nobody else anything", async () => {
    const w = await world();
    for (const [who, label] of [[w.owner, "owner"], [w.partner, "partner"], [w.sup, "supervisor"]] as const) {
      await as(who.id);
      expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: {} }, { id: w.r1.id })).status, `${label} review`).toBe(200);
      expect((await send(goalsRoute.POST, "POST", { title: `هدف ${label}` }, { id: w.r1.id })).status, `${label} goal`).toBe(201);
      expect((await send(notesRoute.POST, "POST", { body: `ملاحظة ${label}` }, { id: w.r1.id })).status, `${label} note`).toBe(201);
    }
    // the supervisor with the switch is refused outside the subtree: 404
    await as(w.sup.id);
    for (const id of [w.x.id, w.y.id]) {
      expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: {} }, { id })).status).toBe(404);
      expect((await send(goalsRoute.POST, "POST", { title: "ه" }, { id })).status).toBe(404);
      expect((await send(notesRoute.POST, "POST", { body: "ن" }, { id })).status).toBe(404);
    }
    // the person: no review or note about themselves, a proposal yes
    await as(w.r1.id);
    expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: {} }, { id: w.r1.id })).status).toBe(404);
    expect((await send(notesRoute.POST, "POST", { body: "ن" }, { id: w.r1.id })).status).toBe(404);
    const proposal = await send(goalsRoute.POST, "POST", { title: "اقتراحي" }, { id: w.r1.id });
    expect(proposal.status).toBe(201);
    expect((proposal.json?.["goal"] as { proposal: boolean }).proposal).toBe(true);
    // a peer, a guest, an outsider: 404 for each
    for (const who of [w.r2, w.guest, w.outsider, w.x]) {
      await as(who.id);
      expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: {} }, { id: w.r1.id })).status).toBe(404);
      expect((await send(goalsRoute.POST, "POST", { title: "و" }, { id: w.r1.id })).status).toBe(404);
      expect((await send(notesRoute.POST, "POST", { body: "ن" }, { id: w.r1.id })).status).toBe(404);
    }
  });

  it("nobody is reviewed who is an OWNER, suspended, a guest or from another company", async () => {
    const w = await world();
    await as(w.owner.id);
    for (const id of [w.partner.id, w.owner.id, w.guest.id, w.outsider.id]) expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: {} }, { id })).status, id).toBe(404);
    expect((await get(scoreRoute.GET, { id: w.partner.id }, `/score?period=${PERIOD}`)).status).toBe(404);
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.r2.id }, data: { status: "SUSPENDED" } });
    expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: {} }, { id: w.r2.id })).status).toBe(404);
    // the owner still reads their old reviews; their supervisor does not
    await as(w.sup.id);
    expect((await get(reviewsRoute.GET, { id: w.r2.id })).status).toBe(404);
    await as(w.owner.id);
    expect((await get(reviewsRoute.GET, { id: w.r2.id })).status).toBe(200);
  });
});

// ───────────────────────────────────────── reviews ─────────────────────────────────────────

describe("reviews: status, privacy, versions, uniqueness", () => {
  it("DRAFT → SUBMITTED → SHARED, in order; submitting needs a rating; only the author or the owner moves it; audited", async () => {
    const w = await world();
    const ratings = await ratingsOf(w, [4, 5]);
    const saved = await review(w, w.sup.id, w.r1.id, { ratings: {}, strengths: "ممتاز" });
    const id = (saved.json?.["review"] as { id: string }).id;
    expect((await advance(w.sup.id, id, "SUBMITTED")).status).toBe(422); // no rating yet
    await review(w, w.sup.id, w.r1.id, { ratings });
    expect((await advance(w.sup.id, id, "SHARED")).status).toBe(403); // not submitted yet
    expect((await advance(w.r1.id, id, "SUBMITTED")).status).toBe(404); // the person cannot touch it
    expect((await advance(w.sup2.id, id, "SUBMITTED")).status).toBe(404);
    expect((await advance(w.sup.id, id, "SUBMITTED")).status).toBe(200);
    expect((await advance(w.sup.id, id, "SUBMITTED")).status).toBe(403); // once
    expect((await advance(w.sup.id, id, "SHARED")).status).toBe(200);
    expect((await advance(w.sup.id, id, "SHARED")).status).toBe(403);
    expect(await db.auditLog.count({ where: { orgId: w.orgId, action: "team.review_submitted", target: w.r1.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { orgId: w.orgId, action: "team.review_shared", target: w.r1.id } })).toBe(1);
    expect("DELETE" in reviewRoute).toBe(false);
  });

  it("the person reads nothing until it is shared, then ratings, light, strengths and improvement, and NEVER the private note (not even as a key)", async () => {
    const w = await world();
    const ratings = await ratingsOf(w, [4, 2]);
    const secret = "سري-للمقيّمين";
    const saved = await review(w, w.sup.id, w.r1.id, { ratings, light: "AMBER", strengths: "نقاط قوة", improvement: "تحسين", privateNote: secret });
    const id = (saved.json?.["review"] as { id: string }).id;
    await advance(w.sup.id, id, "SUBMITTED");
    await as(w.r1.id);
    expect((await get(reviewsRoute.GET, { id: w.r1.id })).json?.["reviews"]).toEqual([]);
    await advance(w.sup.id, id, "SHARED");
    await as(w.r1.id);
    const mine = await get(reviewsRoute.GET, { id: w.r1.id });
    const list = mine.json?.["reviews"] as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ strengths: "نقاط قوة", improvement: "تحسين", light: "AMBER", status: "SHARED" });
    expect(mine.text).not.toContain(secret);
    expect(mine.text).not.toContain("privateNote");
    // the supervisor and the owner read the private note
    for (const who of [w.sup, w.owner]) {
      await as(who.id);
      expect((await get(reviewsRoute.GET, { id: w.r1.id })).text, who.name).toContain(secret);
    }
    // and the page: the person's file has no trace of the note; the supervisor's has it
    await as(w.r1.id);
    const own = await html(PersonPage({ params: { id: w.r1.id }, searchParams: { tab: "reviews" } }));
    expect(own).toContain("data-reviews-panel");
    expect(own).not.toContain(secret);
    expect(own).not.toContain("data-review-form");
    await as(w.sup.id);
    const theirs = await html(PersonPage({ params: { id: w.r1.id }, searchParams: { tab: "reviews" } }));
    expect(theirs).toContain(secret);
    expect(theirs).toContain("data-review-form");
  });

  it("one live review per reviewer, person and period; two reviewers each have their own; the database refuses a duplicate version", async () => {
    const w = await world();
    const ratings = await ratingsOf(w, [3]);
    await review(w, w.sup.id, w.r1.id, { ratings });
    await review(w, w.sup.id, w.r1.id, { ratings, strengths: "تحديث" });
    expect(await db.review.count({ where: { userId: w.r1.id, reviewerId: w.sup.id, period: PERIOD } })).toBe(1);
    await review(w, w.owner.id, w.r1.id, { ratings });
    expect(await db.review.count({ where: { userId: w.r1.id, period: PERIOD } })).toBe(2);
    await expect(db.review.create({ data: { organizationId: w.orgId, userId: w.r1.id, reviewerId: w.sup.id, period: PERIOD, version: 1 } })).rejects.toThrow();
    // two saves at once make one row
    const [a, b] = await Promise.all([review(w, w.sup.id, w.r2.id, { ratings }), review(w, w.sup.id, w.r2.id, { ratings })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await db.review.count({ where: { userId: w.r2.id, reviewerId: w.sup.id, period: PERIOD } })).toBe(1);
  });

  it("a SHARED review is locked: saving again is refused, `newVersion` starts version 2 as a DRAFT, and the person still sees version 1 until 2 is shared", async () => {
    const w = await world();
    const ratings = await ratingsOf(w, [5]);
    const saved = await review(w, w.sup.id, w.r1.id, { ratings, strengths: "النسخة الأولى" });
    const id = (saved.json?.["review"] as { id: string }).id;
    await advance(w.sup.id, id, "SUBMITTED");
    await advance(w.sup.id, id, "SHARED");
    const locked = await review(w, w.sup.id, w.r1.id, { ratings, strengths: "تعديل" });
    expect(locked.status).toBe(403);
    expect(JSON.stringify(locked.json)).toContain("teamdev.review_locked");
    const v2 = await review(w, w.sup.id, w.r1.id, { ratings: { ...ratings }, strengths: "النسخة الثانية", newVersion: true });
    expect(v2.status).toBe(200);
    expect(v2.json).toMatchObject({ newVersion: true, review: { version: 2, status: "DRAFT" } });
    expect((await db.review.findUniqueOrThrow({ where: { id } })).strengths).toBe("النسخة الأولى"); // the old one is untouched
    await as(w.r1.id);
    const seen = (await get(reviewsRoute.GET, { id: w.r1.id })).json?.["reviews"] as { version: number; strengths: string }[];
    expect(seen.map((r) => [r.version, r.strengths])).toEqual([[1, "النسخة الأولى"]]);
    // the supervisor sees both versions, the new one live
    await as(w.sup.id);
    const all = (await get(reviewsRoute.GET, { id: w.r1.id })).json?.["reviews"] as { version: number; live: boolean }[];
    expect(all.map((r) => [r.version, r.live]).sort()).toEqual([[1, false], [2, true]]);
    // saving again edits the draft in place (no version 3)
    await review(w, w.sup.id, w.r1.id, { ratings, strengths: "ما زال المسودة" });
    expect(await db.review.count({ where: { userId: w.r1.id, reviewerId: w.sup.id } })).toBe(2);
  });

  it("validation: a period is a month or a quarter and not in the future; ratings are 1-5 of this company's criteria; texts at most 1000", async () => {
    const w = await world();
    const ratings = await ratingsOf(w, [3]);
    await as(w.owner.id);
    for (const period of ["2026-13", "x", "2026-Q5", ""]) expect((await send(reviewsRoute.PUT, "PUT", { period, ratings: {} }, { id: w.r1.id })).status, period).toBe(422);
    expect(JSON.stringify((await send(reviewsRoute.PUT, "PUT", { period: "2099-01", ratings: {} }, { id: w.r1.id })).json)).toContain("teamdev.period_future");
    expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings }, { id: w.r1.id })).status).toBe(200);
    for (const bad of [0, 6, 2.5]) expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: { [Object.keys(ratings)[0]!]: bad } }, { id: w.r1.id })).status, String(bad)).toBe(422);
    expect(JSON.stringify((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: { nonsense: 3 } }, { id: w.r1.id })).json)).toContain("teamdev.criterion_unknown");
    expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings, light: "BLUE" }, { id: w.r1.id })).status).toBe(422);
    for (const key of ["strengths", "improvement", "privateNote"]) expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings, [key]: "ا".repeat(1001) }, { id: w.r1.id })).status, key).toBe(422);
    expect((await send(reviewsRoute.PUT, "PUT", { period: "2026-Q4", ratings, strengths: "ا".repeat(1000) }, { id: w.r1.id })).status).toBe(200);
  });
});

// ───────────────────────────────────────── the criteria and the weights ─────────────────────────────────────────

describe("criteria and weights: the owner's alone", () => {
  it("the five defaults are there; the owner renames, adds up to 8 in use, archives (never deletes); nobody else", async () => {
    const w = await world();
    await as(w.member.id);
    const list = (await get(criteriaRoute.GET)).json?.["criteria"] as { id: string; name: string }[];
    expect(list.map((c) => c.name)).toEqual(["جودة الشغل", "الالتزام بالمواعيد", "التعاون", "المبادرة", "التواصل"]);
    expect((await send(criteriaRoute.POST, "POST", { name: "جديد" })).status).toBe(404);
    expect((await send(criterionRoute.PATCH, "PATCH", { name: "ج" }, { id: list[0]!.id })).status).toBe(404);
    await as(w.owner.id);
    expect((await send(criterionRoute.PATCH, "PATCH", { name: "إتقان الشغل" }, { id: list[0]!.id })).status).toBe(200);
    for (const n of ["أ", "ب", "ج"]) expect((await send(criteriaRoute.POST, "POST", { name: `معيار ${n}` })).status).toBe(201);
    const over = await send(criteriaRoute.POST, "POST", { name: "التاسع" });
    expect(over.status).toBe(422);
    expect(JSON.stringify(over.json)).toContain("teamdev.criteria_limit");
    expect((await send(criterionRoute.PATCH, "PATCH", { archived: true }, { id: list[1]!.id })).status).toBe(200);
    expect((await send(criteriaRoute.POST, "POST", { name: "التاسع" })).status).toBe(201); // a place is free once one is retired
    expect("DELETE" in criterionRoute).toBe(false);
    expect(JSON.stringify((await send(criteriaRoute.POST, "POST", { name: "معيار أ" })).json)).toContain("teamdev.criterion_name_taken");
    expect(await db.reviewCriterion.count({ where: { organizationId: w.orgId } })).toBe(9);
  });

  it("an archived criterion keeps its old ratings readable and takes no new ones", async () => {
    const w = await world();
    const ratings = await ratingsOf(w, [4]);
    const cid = Object.keys(ratings)[0]!;
    const saved = await review(w, w.owner.id, w.r1.id, { ratings });
    await as(w.owner.id);
    await send(criterionRoute.PATCH, "PATCH", { archived: true }, { id: cid });
    // the open review may still carry it; a new review of another period may not
    expect((await review(w, w.owner.id, w.r1.id, { ratings, strengths: "ما زال" })).status).toBe(200);
    const other = await send(reviewsRoute.PUT, "PUT", { period: "2026-09", ratings }, { id: w.r1.id });
    expect(other.status).toBe(422);
    expect(JSON.stringify(other.json)).toContain("teamdev.criterion_archived");
    expect(((await get(reviewsRoute.GET, { id: w.r1.id })).json?.["reviews"] as { id: string }[]).map((r) => r.id)).toContain((saved.json?.["review"] as { id: string }).id);
  });

  it("the weights: the owner sets them (whole numbers, one above zero), every reader sees them, nobody else sets them", async () => {
    const w = await world();
    await as(w.sup.id);
    expect((await get(weightsRoute.GET)).json?.["weights"]).toEqual({ manual: 50, completed: 20, onTime: 20, steps: 10 });
    expect((await send(weightsRoute.PUT, "PUT", { manual: 100, completed: 0, onTime: 0, steps: 0 })).status).toBe(404);
    await as(w.owner.id);
    for (const bad of [{ manual: 0, completed: 0, onTime: 0, steps: 0 }, { manual: 50.5, completed: 20, onTime: 20, steps: 10 }, { manual: -1, completed: 20, onTime: 20, steps: 10 }, { manual: 50, completed: 20, onTime: 20 }]) {
      expect((await send(weightsRoute.PUT, "PUT", bad)).status, JSON.stringify(bad)).toBe(422);
    }
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.orgId } });
    await db.organization.update({ where: { id: w.orgId }, data: { settings: { ...(org.settings as object), keep: "me" } } });
    expect((await send(weightsRoute.PUT, "PUT", { manual: 40, completed: 30, onTime: 20, steps: 10 })).status).toBe(200);
    expect((await db.organization.findUniqueOrThrow({ where: { id: w.orgId } })).settings).toMatchObject({ keep: "me", teamDevelopment: { weights: { manual: 40, completed: 30, onTime: 20, steps: 10 } } });
    await as(w.sup.id);
    expect((await get(weightsRoute.GET)).json?.["weights"]).toEqual({ manual: 40, completed: 30, onTime: 20, steps: 10 });
  });
});

// ───────────────────────────────────────── the score ─────────────────────────────────────────

describe("the score: numbers equal the board's, missing indicators are left out, the person's own view is built on what was shared", () => {
  /** October: r1 4 done (3 on time, 1 late), r2 2 done (on time), x 4 done, y 6 done (no due day). The team median of 4,2,4,6 is 4. */
  async function october(w: World) {
    for (const d of ["2026-10-02", "2026-10-03", "2026-10-04"]) await w.done(w.r1.id, `${d}T09:00:00Z`, `${d}T20:00:00Z`);
    await w.done(w.r1.id, "2026-10-12T09:00:00Z", "2026-10-05T20:00:00Z"); // late
    for (const d of ["2026-10-06", "2026-10-07"]) await w.done(w.r2.id, `${d}T09:00:00Z`, `${d}T20:00:00Z`);
    for (const d of ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]) await w.done(w.x.id, `${d}T09:00:00Z`);
    for (const d of ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]) await w.done(w.y.id, `${d}T09:00:00Z`);
  }
  const scoreOf = async (viewer: string, userId: string, period = PERIOD) => {
    await as(viewer);
    const res = await get(scoreRoute.GET, { id: userId }, `/score?period=${period}`);
    expect(res.status).toBe(200);
    return res.json?.["score"] as {
      score: number | null; band: string | null; light: string | null; suggestedLight: string | null; sharedOnly: boolean;
      manual: { value: number | null; share: number | null; reviews: number; average: number | null };
      completed: { value: number | null; count: number; baseline: { value: number; source: string } | null; share: number | null };
      onTime: { value: number | null; onTime: number; withDue: number; rate: number | null };
      steps: { value: number | null; count: number; baseline: unknown };
      extras: { trackedMinutes: number | null; messages: number; overdueNow: number; openNow: number };
    };
  };

  it("the automatic indicators equal the owner board's numbers for the same days, and the arithmetic is the documented one", async () => {
    const w = await world();
    await october(w);
    const s = await scoreOf(w.owner.id, w.r1.id);
    await as(w.owner.id);
    const overview = await loadOverview(await boardAccess(await requireActor()), { from: "2026-10-01", to: "2026-10-31" }, { now: at("2026-10-31T09:00:00Z") });
    const row = overview.people.find((p) => p.userId === w.r1.id)!;
    expect(s.completed.count).toBe(row.completed);
    expect(s.onTime).toMatchObject({ onTime: row.onTime, withDue: row.withDue, rate: row.onTimeRate });
    expect(row).toMatchObject({ completed: 4, onTime: 3, withDue: 4 });
    // baseline: nobody had a September, so the team's median (4) over the four people who finished something
    expect(s.completed.baseline).toMatchObject({ value: 4, source: "team" });
    expect(s.completed.value).toBe(100);
    expect(s.onTime.value).toBe(75);
    expect(s.steps.value).toBeNull(); // no steps ticked and no baseline: left out, never invented
    expect(s.manual.value).toBeNull();
    // (100·20 + 75·20) ÷ 40 = 87.5, shown 88; the shares add up to 100 over the two present ones
    expect(s.score).toBe(88);
    expect(s.completed.share).toBe(50);
    expect(s.band).toBe("excellent");
    expect(s.suggestedLight).toBe("GREEN");
    expect(s.light).toBeNull(); // nobody has set a light: the system's is only a suggestion
    const r2 = await scoreOf(w.owner.id, w.r2.id);
    expect(r2.completed.value).toBe(50);
    expect(r2.score).toBe(75); // (50·20 + 100·20) ÷ 40
  });

  it("a person's own history is their baseline: the median of the last periods in which they finished something", async () => {
    const w = await world();
    await october(w);
    for (const [n, month] of [[10, "09"], [6, "08"], [8, "07"]] as const) for (let i = 0; i < n; i++) await w.done(w.r1.id, `2026-${month}-${String(i + 1).padStart(2, "0")}T09:00:00Z`);
    const s = await scoreOf(w.owner.id, w.r1.id);
    expect(s.completed.baseline).toMatchObject({ value: 8, source: "own" });
    expect(s.completed.value).toBe(50); // 4 of 8
  });

  it("the manual part counts SUBMITTED and SHARED reviews (a draft counts for nothing), the reviewers' light is the one that counts, and the person's own view uses only what was shared with them", async () => {
    const w = await world();
    await october(w);
    const ratings = await ratingsOf(w, [5, 3]); // average 4 → 75
    const saved = await review(w, w.sup.id, w.r1.id, { ratings, light: "GREEN" });
    const id = (saved.json?.["review"] as { id: string }).id;
    expect((await scoreOf(w.owner.id, w.r1.id)).manual.reviews).toBe(0); // a draft
    await advance(w.sup.id, id, "SUBMITTED");
    const submitted = await scoreOf(w.sup.id, w.r1.id);
    expect(submitted.manual).toMatchObject({ value: 75, reviews: 1, average: 4 });
    expect(submitted.light).toBe("GREEN");
    // (75·50 + 100·20 + 75·20) ÷ 90 = 80.56 → 81
    expect(submitted.score).toBe(81);
    // the person: nothing shared yet, so the score is the automatic one and the light is empty
    const own = await scoreOf(w.r1.id, w.r1.id);
    expect(own.sharedOnly).toBe(true);
    expect(own.manual.value).toBeNull();
    expect(own.score).toBe(88);
    expect(own.light).toBeNull();
    await advance(w.sup.id, id, "SHARED");
    const shared = await scoreOf(w.r1.id, w.r1.id);
    expect(shared.manual.value).toBe(75);
    expect(shared.score).toBe(81);
    expect(shared.light).toBe("GREEN");
    // two reviewers: the most worrying light is the one shown
    const owner = await review(w, w.owner.id, w.r1.id, { ratings, light: "AMBER" });
    await advance(w.owner.id, (owner.json?.["review"] as { id: string }).id, "SUBMITTED");
    expect((await scoreOf(w.owner.id, w.r1.id)).light).toBe("AMBER");
    expect((await scoreOf(w.owner.id, w.r1.id)).manual.reviews).toBe(2);
  });

  it("a new version counts only once submitted: a draft correction does not replace the live review", async () => {
    const w = await world();
    const high = await ratingsOf(w, [5, 5]);
    const saved = await review(w, w.sup.id, w.r1.id, { ratings: high });
    const id = (saved.json?.["review"] as { id: string }).id;
    await advance(w.sup.id, id, "SUBMITTED");
    await advance(w.sup.id, id, "SHARED");
    const low = Object.fromEntries(Object.keys(high).map((k) => [k, 1]));
    await review(w, w.sup.id, w.r1.id, { ratings: low, newVersion: true });
    expect((await scoreOf(w.owner.id, w.r1.id)).manual.value).toBe(100); // still version 1
    const v2 = (await db.review.findFirstOrThrow({ where: { userId: w.r1.id, version: 2 } })).id;
    await advance(w.sup.id, v2, "SUBMITTED");
    expect((await scoreOf(w.owner.id, w.r1.id)).manual.value).toBe(0); // version 2 is the one that counts
    // the person still sees version 1's rating until version 2 is shared
    expect((await scoreOf(w.r1.id, w.r1.id)).manual.value).toBe(100);
  });

  it("nothing to compute from is «—», not zero: no score, no band, no suggestion; the extras (open, overdue, messages, time) are shown beside, never in it", async () => {
    const w = await world();
    const s = await scoreOf(w.owner.id, w.r2.id);
    expect(s).toMatchObject({ score: null, band: null, suggestedLight: null });
    expect(s.manual.value).toBeNull();
    expect(s.onTime.value).toBeNull();
    // minutes tracked: a plain number, from the time report's own rule
    await db.timeEntry.create({ data: { orgId: w.orgId, workspaceId: w.ws.id, userId: w.r2.id, taskTitle: "وقت", startedAt: at("2026-10-05T08:00:00Z"), stoppedAt: at("2026-10-05T09:30:00Z"), seconds: 5400, source: "MANUAL" } });
    expect((await scoreOf(w.owner.id, w.r2.id)).extras.trackedMinutes).toBe(90);
    expect((await scoreOf(w.owner.id, w.r2.id)).score).toBeNull(); // time never enters the composite
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.orgId } });
    await db.organization.update({ where: { id: w.orgId }, data: { settings: withFeature(org.settings, "timeTracking", false) as Prisma.InputJsonValue } });
    expect((await scoreOf(w.owner.id, w.r2.id)).extras.trackedMinutes).toBeNull();
  });

  it("the owner's weights change the composite and a weight of 0 switches an indicator off", async () => {
    const w = await world();
    await october(w);
    const ratings = await ratingsOf(w, [5, 5]);
    const saved = await review(w, w.owner.id, w.r1.id, { ratings });
    await advance(w.owner.id, (saved.json?.["review"] as { id: string }).id, "SUBMITTED");
    await as(w.owner.id);
    await send(weightsRoute.PUT, "PUT", { manual: 100, completed: 0, onTime: 0, steps: 0 });
    expect((await scoreOf(w.owner.id, w.r1.id)).score).toBe(100);
    await send(weightsRoute.PUT, "PUT", { manual: 0, completed: 0, onTime: 100, steps: 0 });
    expect((await scoreOf(w.owner.id, w.r1.id)).score).toBe(75);
  });

  it("the table: sorted by name unless the score column is clicked; the owner reads everybody, a supervisor their subtree, the person and a guest get 404; the CSV is exactly that table", async () => {
    const w = await world();
    await october(w);
    await as(w.owner.id);
    const byName = (await get(peopleRoute.GET, {}, `/people?period=${PERIOD}`)).json?.["table"] as { sort: string; rows: { userId: string; name: string; score: number | null }[] };
    expect(byName.sort).toBe("name");
    expect(byName.rows.map((r) => r.name)).toEqual([...byName.rows.map((r) => r.name)].sort((a, b) => a.localeCompare(b, "ar")));
    expect(byName.rows.map((r) => r.userId)).not.toContain(w.partner.id);
    expect(byName.rows.map((r) => r.userId)).not.toContain(w.guest.id);
    const byScore = (await get(peopleRoute.GET, {}, `/people?period=${PERIOD}&sort=score`)).json?.["table"] as typeof byName;
    expect(byScore.sort).toBe("score");
    const scores = byScore.rows.map((r) => r.score ?? -1);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    await as(w.sup.id);
    const mine = (await get(peopleRoute.GET, {}, `/people?period=${PERIOD}`)).json?.["table"] as typeof byName;
    expect(mine.rows.map((r) => r.userId).sort()).toEqual([w.r1.id, w.r2.id].sort());
    for (const who of [w.r1, w.guest, w.outsider, w.member]) {
      await as(who.id);
      expect((await get(peopleRoute.GET, {}, `/people?period=${PERIOD}`)).status, who.name).toBe(404);
      expect((await get(peopleCsvRoute.GET, {}, `/people/csv?period=${PERIOD}`)).status, who.name).toBe(404);
    }
    // the CSV: BOM, formula-safe, only the subtree
    await db.user.update({ where: { id: w.r1.id }, data: { name: "=SUM(A1)" } });
    await as(w.sup.id);
    const res = await (peopleCsvRoute.GET as (req: Request) => Promise<Response>)(new Request(`http://localhost/api/team-development/people/csv?period=${PERIOD}`));
    expect([...new Uint8Array(await res.clone().arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await res.text();
    expect(text).toContain("'=SUM(A1)");
    expect(text).not.toContain(w.x.name);
    expect(text).not.toContain("privateNote");
  });

  it("a period that is not a period, or has not begun, is refused; a quarter works", async () => {
    const w = await world();
    await as(w.owner.id);
    expect((await get(scoreRoute.GET, { id: w.r1.id }, "/score?period=nonsense")).status).toBe(422);
    expect((await get(scoreRoute.GET, { id: w.r1.id }, "/score?period=2099-01")).status).toBe(422);
    const q = await get(scoreRoute.GET, { id: w.r1.id }, "/score?period=2026-Q4");
    expect(q.status).toBe(200);
    expect((q.json?.["score"] as { period: { kind: string } }).period.kind).toBe("quarter");
  });

  it("the screens: the formula box prints the weights and the rules, the table has its legend, «اقتراح» marks the system's light, a person sees their own score tab", async () => {
    const w = await world();
    await october(w);
    await as(w.owner.id);
    const home = await html(DevelopmentPage({ searchParams: { period: PERIOD } }));
    expect(home).toContain("data-score-table");
    expect(home).toContain("data-sort-score");
    expect(home).toContain("data-suggested=\"true\"");
    const page = await html(PersonPage({ params: { id: w.r1.id }, searchParams: { tab: "score", period: PERIOD } }));
    expect(page).toContain("data-score-view");
    expect(page).toContain("data-score-formula");
    expect(page).toContain("data-formula-weights");
    for (const key of ["manual", "completed", "onTime", "steps"]) expect(page).toContain(`data-indicator="${key}"`);
    await as(w.r1.id);
    const mine = await html(PersonPage({ params: { id: w.r1.id }, searchParams: { tab: "score", period: PERIOD } }));
    expect(mine).toContain("data-score-view");
    expect(mine).toContain("data-score=\"88\"");
    // the person's own page lists nobody else and offers no table
    expect(mine).not.toContain("data-score-table");
    await expect(Promise.resolve().then(() => SettingsPage())).rejects.toThrow("NEXT_NOT_FOUND");
    await as(w.owner.id);
    expect(await html(SettingsPage())).toContain("data-weights-form");
  });
});

// ───────────────────────────────────────── the plan and the notes ─────────────────────────────────────────

describe("«خطة التطوير»: goals, proposals and the one-click level", () => {
  it("a supervisor writes goals; the person proposes; only a supervisor accepts; the person edits or cancels only their own proposal", async () => {
    const w = await world();
    const skill = await mkSkill(w, "عرض");
    await as(w.sup.id);
    const goal = await send(goalsRoute.POST, "POST", { skillId: skill.id, targetLevel: 3, actions: "تدريب", dueDate: "2026-12-01" }, { id: w.r1.id });
    expect(goal.status).toBe(201);
    expect(goal.json?.["goal"]).toMatchObject({ title: "عرض", targetLevel: 3, proposal: false, status: "OPEN", skillName: "عرض", dueDate: "2026-12-01" });
    await as(w.r1.id);
    const proposal = await send(goalsRoute.POST, "POST", { title: "أتعلم التصوير" }, { id: w.r1.id });
    const pid = (proposal.json?.["goal"] as { id: string }).id;
    expect((await send(goalRoute.PATCH, "PATCH", { accept: true }, { id: pid })).status).toBe(403);
    expect((await send(goalRoute.PATCH, "PATCH", { status: "DONE" }, { id: pid })).status).toBe(403);
    expect((await send(goalRoute.PATCH, "PATCH", { title: "أتعلم التصوير بالكاميرا" }, { id: pid })).status).toBe(200);
    // the supervisor's own goal is not the person's to edit
    const gid = (goal.json?.["goal"] as { id: string }).id;
    expect((await send(goalRoute.PATCH, "PATCH", { title: "تغيير" }, { id: gid })).status).toBe(403);
    await as(w.sup.id);
    const accepted = await send(goalRoute.PATCH, "PATCH", { accept: true }, { id: pid });
    expect(accepted.json?.["goal"]).toMatchObject({ proposal: false, title: "أتعلم التصوير بالكاميرا" });
    // once accepted the person cannot change it
    await as(w.r1.id);
    expect((await send(goalRoute.PATCH, "PATCH", { status: "CANCELLED" }, { id: pid })).status).toBe(403);
    // a peer and an outsider do not find the goal at all
    for (const who of [w.r2, w.sup2, w.guest]) {
      await as(who.id);
      expect((await send(goalRoute.PATCH, "PATCH", { title: "ز" }, { id: pid })).status, who.name).toBe(404);
    }
  });

  it("validation: a title or a skill, a level only with a skill, ≤120 and ≤500, a real due day, an archived skill refused", async () => {
    const w = await world();
    const skill = await mkSkill(w, "حية");
    const old = await mkSkill(w, "قديمة", new Date());
    await as(w.owner.id);
    const post = (body: Record<string, unknown>) => send(goalsRoute.POST, "POST", body, { id: w.r1.id });
    expect((await post({})).status).toBe(422);
    expect((await post({ title: "ا".repeat(121) })).status).toBe(422);
    expect((await post({ title: "ت", actions: "ا".repeat(501) })).status).toBe(422);
    expect((await post({ title: "ت", targetLevel: 3 })).status).toBe(422);
    expect((await post({ skillId: skill.id, targetLevel: 5 })).status).toBe(422);
    expect((await post({ title: "ت", dueDate: "2026-02-30" })).status).toBe(422);
    expect((await post({ title: "ت", dueDate: "غدا" })).status).toBe(422);
    expect(JSON.stringify((await post({ skillId: old.id })).json)).toContain("teamdev.skill_archived");
    expect((await post({ skillId: "nope" })).status).toBe(404);
    expect((await post({ title: "ا".repeat(120), skillId: skill.id, targetLevel: 4 })).status).toBe(201);
  });

  it("a DONE goal sets the skill's level in one click, once, with a history row; refused before it is DONE, to anybody who may not enter levels, and for a skill that was archived meanwhile", async () => {
    const w = await world();
    const skill = await mkSkill(w, "قيادة");
    await as(w.sup.id);
    const gid = ((await send(goalsRoute.POST, "POST", { skillId: skill.id, targetLevel: 3 }, { id: w.r1.id })).json?.["goal"] as { id: string }).id;
    expect((await send(applyRoute.POST, "POST", {}, { id: gid })).status).toBe(422); // still OPEN
    await send(goalRoute.PATCH, "PATCH", { status: "DONE" }, { id: gid });
    // the person and a supervisor without the switch cannot confirm
    await as(w.r1.id);
    expect((await send(applyRoute.POST, "POST", {}, { id: gid })).status).toBe(404);
    await as(w.supNo.id);
    expect((await send(applyRoute.POST, "POST", {}, { id: gid })).status).toBe(404);
    await as(w.sup.id);
    const listed = (await get(goalsRoute.GET, { id: w.r1.id })).json?.["goals"] as { id: string; canApply: boolean }[];
    expect(listed.find((g) => g.id === gid)?.canApply).toBe(true);
    const ok = await send(applyRoute.POST, "POST", {}, { id: gid });
    expect(ok.status).toBe(200);
    const level = await db.personSkill.findUniqueOrThrow({ where: { userId_skillId_source: { userId: w.r1.id, skillId: skill.id, source: "MANUAL" } } });
    expect(level.level).toBe(3);
    const hist = await db.personSkillHistory.findMany({ where: { userId: w.r1.id, skillId: skill.id } });
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ oldLevel: null, newLevel: 3, reason: `goal:${gid}`, changedById: w.sup.id, source: "MANUAL" });
    // once only, even with two clicks at once
    expect((await send(applyRoute.POST, "POST", {}, { id: gid })).status).toBe(422);
    const g2 = ((await send(goalsRoute.POST, "POST", { skillId: skill.id, targetLevel: 4 }, { id: w.r1.id })).json?.["goal"] as { id: string }).id;
    await send(goalRoute.PATCH, "PATCH", { status: "DONE" }, { id: g2 });
    const both = await Promise.all([send(applyRoute.POST, "POST", {}, { id: g2 }), send(applyRoute.POST, "POST", {}, { id: g2 })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await db.personSkillHistory.count({ where: { userId: w.r1.id, skillId: skill.id } })).toBe(2);
    // an archived skill refuses, and the goal stays confirmable after the skill is back
    const g3 = ((await send(goalsRoute.POST, "POST", { skillId: skill.id, targetLevel: 2 }, { id: w.r2.id })).json?.["goal"] as { id: string }).id;
    await send(goalRoute.PATCH, "PATCH", { status: "DONE" }, { id: g3 });
    await db.skill.update({ where: { id: skill.id }, data: { archivedAt: new Date() } });
    expect(JSON.stringify((await send(applyRoute.POST, "POST", {}, { id: g3 })).json)).toContain("teamdev.skill_archived");
    expect((await db.devGoal.findUniqueOrThrow({ where: { id: g3 } })).appliedAt).toBeNull();
  });

  it("the person reads their own plan and nobody else's", async () => {
    const w = await world();
    await as(w.sup.id);
    await send(goalsRoute.POST, "POST", { title: "هدف أول" }, { id: w.r1.id });
    await as(w.r1.id);
    expect(((await get(goalsRoute.GET, { id: w.r1.id })).json?.["goals"] as unknown[]).length).toBe(1);
    await as(w.r2.id);
    expect((await get(goalsRoute.GET, { id: w.r1.id })).status).toBe(404);
  });
});

describe("«ملاحظات ١:١»: private to the owner and the supervisors, shared one by one", () => {
  it("the person reads only the notes marked shared, never an unshared body; sharing and taking back is the author's or the owner's", async () => {
    const w = await world();
    const hidden = "ملاحظة-خاصة-جدا";
    const open = "ملاحظة-مشتركة";
    await as(w.sup.id);
    const a = await send(notesRoute.POST, "POST", { body: hidden }, { id: w.r1.id });
    const b = await send(notesRoute.POST, "POST", { body: open, shared: true }, { id: w.r1.id });
    expect(a.status).toBe(201);
    await as(w.r1.id);
    const mine = await get(notesRoute.GET, { id: w.r1.id });
    expect((mine.json?.["notes"] as { body: string }[]).map((n) => n.body)).toEqual([open]);
    expect(mine.text).not.toContain(hidden);
    const idA = (a.json?.["note"] as { id: string }).id;
    const idB = (b.json?.["note"] as { id: string }).id;
    // the person cannot share, unshare or write
    expect((await send(noteRoute.PATCH, "PATCH", { shared: true }, { id: idA })).status).toBe(404);
    expect((await send(noteRoute.PATCH, "PATCH", { shared: false }, { id: idB })).status).toBe(404);
    // another supervisor of the same person does not exist; the owner may share another's note
    await as(w.owner.id);
    expect((await get(notesRoute.GET, { id: w.r1.id })).text).toContain(hidden);
    expect((await send(noteRoute.PATCH, "PATCH", { shared: true }, { id: idA })).status).toBe(200);
    await as(w.r1.id);
    expect((await get(notesRoute.GET, { id: w.r1.id })).text).toContain(hidden);
    await as(w.sup.id);
    expect((await send(noteRoute.PATCH, "PATCH", { shared: false }, { id: idA })).status).toBe(200);
    await as(w.r1.id);
    expect((await get(notesRoute.GET, { id: w.r1.id })).text).not.toContain(hidden);
    // validation, and no delete
    await as(w.sup.id);
    expect((await send(notesRoute.POST, "POST", { body: "" }, { id: w.r1.id })).status).toBe(422);
    expect((await send(notesRoute.POST, "POST", { body: "ا".repeat(1001) }, { id: w.r1.id })).status).toBe(422);
    expect("DELETE" in noteRoute).toBe(false);
    // a peer reads none
    await as(w.r2.id);
    expect((await get(notesRoute.GET, { id: w.r1.id })).status).toBe(404);
    // the page: the person's tab shows the shared note only
    await as(w.r1.id);
    const own = await html(PersonPage({ params: { id: w.r1.id }, searchParams: { tab: "notes" } }));
    expect(own).toContain(open);
    expect(own).not.toContain(hidden);
    expect(own).not.toContain("data-note-form");
  });
});

// ───────────────────────────────────────── the switch ─────────────────────────────────────────

describe("the switch: off, every route and page of part 2 is 404 for everybody", () => {
  it("answers 404 to the owner too, keeps the data, and is back with the switch", async () => {
    const w = await world();
    const ratings = await ratingsOf(w, [4]);
    const saved = await review(w, w.sup.id, w.r1.id, { ratings });
    const rid = (saved.json?.["review"] as { id: string }).id;
    await as(w.sup.id);
    await send(goalsRoute.POST, "POST", { title: "هدف" }, { id: w.r1.id });
    await send(notesRoute.POST, "POST", { body: "ملاحظة" }, { id: w.r1.id });
    await setFeature(w, false);
    const gets: [unknown, Record<string, string>, string][] = [
      [peopleRoute.GET, {}, "/people"],
      [peopleCsvRoute.GET, {}, "/people/csv"],
      [scoreRoute.GET, { id: w.r1.id }, `/score?period=${PERIOD}`],
      [reviewsRoute.GET, { id: w.r1.id }, ""],
      [goalsRoute.GET, { id: w.r1.id }, ""],
      [notesRoute.GET, { id: w.r1.id }, ""],
      [criteriaRoute.GET, {}, ""],
      [weightsRoute.GET, {}, ""],
      [skillsRoute.GET, {}, ""],
    ];
    for (const who of [w.owner, w.sup, w.r1]) {
      await as(who.id);
      for (const [handler, params, query] of gets) expect((await get(handler, params, query)).status, who.name).toBe(404);
      expect((await send(reviewsRoute.PUT, "PUT", { period: PERIOD, ratings: {} }, { id: w.r1.id })).status).toBe(404);
      expect((await send(reviewRoute.PATCH, "PATCH", { status: "SUBMITTED" }, { id: rid })).status).toBe(404);
      expect((await send(weightsRoute.PUT, "PUT", { manual: 100, completed: 0, onTime: 0, steps: 0 })).status).toBe(404);
    }
    await as(w.owner.id);
    await expect(Promise.resolve().then(() => SettingsPage())).rejects.toThrow("NEXT_NOT_FOUND");
    await setFeature(w, true);
    expect((await get(reviewsRoute.GET, { id: w.r1.id })).status).toBe(200);
    expect(await db.review.count({ where: { userId: w.r1.id } })).toBe(1);
    expect(await db.devGoal.count({ where: { userId: w.r1.id } })).toBe(1);
    expect(await db.reviewNote.count({ where: { userId: w.r1.id } })).toBe(1);
  });

  it("reading leaves no trace: no audit row, no notification, no write, for the owner or anybody", async () => {
    const w = await world();
    const ratings = await ratingsOf(w, [4]);
    await review(w, w.sup.id, w.r1.id, { ratings });
    const count = async () => ({ audit: await db.auditLog.count(), notes: await db.notification.count(), reviews: await db.review.count(), goals: await db.devGoal.count(), crit: await db.reviewCriterion.count() });
    const before = await count();
    for (const who of [w.owner, w.partner, w.sup, w.r1]) {
      await as(who.id);
      for (const [handler, params, query] of [[peopleRoute.GET, {}, `/people?period=${PERIOD}`], [scoreRoute.GET, { id: w.r1.id }, `/score?period=${PERIOD}`], [reviewsRoute.GET, { id: w.r1.id }, ""], [goalsRoute.GET, { id: w.r1.id }, ""], [notesRoute.GET, { id: w.r1.id }, ""], [weightsRoute.GET, {}, ""]] as const) await get(handler, params, query);
    }
    expect(await count()).toEqual(before);
  });
});
