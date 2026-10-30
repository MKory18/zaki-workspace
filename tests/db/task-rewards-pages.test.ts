import { describe, expect, it, vi } from "vitest";

// The pages call redirect()/notFound() and their client rows call useRouter(); no running Next app is needed here.
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

import ListPage from "@/app/(app)/list/page";
import BoardPage from "@/app/(app)/boards/[id]/page";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import TaskPage from "@/app/(app)/tasks/[id]/page";
import * as featuresRoute from "@/app/api/settings/features/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { getMyWork } from "@/server/services/my-work";
import { pinnedTasks } from "@/server/services/pinned";
import { rewardLensFor } from "@/server/services/rewards";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { html } from "./pages-access-helpers";

/**
 * «مهمة بمكافأة» and «تثبيت» on the screens: what each person is shown. The server decides — a partner is handed no reward at
 * all, a member sees the badge and the card read-only with the lock line, the owner gets the controls, and the owner and the
 * space's admin get the pin button. Real pages, real database.
 */
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
const DAY = 86_400_000;

async function world() {
  const t = await makeTeam();
  const lead = await makeUser({ orgId: t.org.id, role: "LEAD", name: "Lead" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.admin.id, role: "ADMIN" }, { userId: lead.id }, { userId: t.member.id }, { userId: t.guest.id, role: "GUEST" }], "مساحة المكافآت");
  const made = await makeProject(ws.id, "مشروع المكافآت");
  const mk = (title: string, extra: Partial<Parameters<typeof makeTask>[0]> = {}) =>
    makeTask({ orgId: t.org.id, workspaceId: ws.id, projectId: made.project.id, boardId: made.board.id, columnId: made.todo.id, creatorId: t.owner.id, assigneeId: t.member.id, title, dueDate: new Date(Date.now() + 3 * DAY), ...extra });
  const rewardTask = async (title: string, over: Record<string, unknown> = {}, extra: Partial<Parameters<typeof makeTask>[0]> = {}) => {
    const task = await mk(title, extra);
    return db.task.update({ where: { id: task.id }, data: { rewardStatus: "OPEN", rewardAmountMinor: 15050, rewardCurrency: "JOD", rewardNote: "ملاحظة-مكافأة-٩٩", ...over } });
  };
  jar().set(SPACE_COOKIE, ws.id);
  return { ...t, lead, ws, made, mk, rewardTask };
}

const REWARD_WORDS = ["مكافأة", "🏆", "data-reward", "150.50", "ملاحظة-مكافأة", "الرواتب", "rewardAmountMinor"];
const taskPage = (id: string) => html(TaskPage({ params: { id } }));
const listPage = (searchParams: Record<string, string> = {}) => html(ListPage({ searchParams }));

describe("the task page", () => {
  it("a partner is handed no reward: no card, no badge, no amount, no note, no money line, and no pin button", async () => {
    const w = await world();
    const task = await w.rewardTask("شغل الشريك");
    await db.task.update({ where: { id: task.id }, data: { pinnedAt: new Date() } });
    await loginAs(w.guest.id);
    const page = await taskPage(task.id);
    expect(page).toContain("شغل الشريك");
    for (const word of REWARD_WORDS) expect(page, word).not.toContain(word);
    expect(page).not.toContain("data-pin-button");
  });

  it("a member sees the card read-only with the lock line, finds the title locked, and has no pin button; the lead likewise", async () => {
    const w = await world();
    const task = await w.rewardTask("مهمة بمكافأة");
    for (const who of [w.member, w.lead]) {
      await loginAs(who.id);
      const page = await taskPage(task.id);
      expect(page, who.name).toContain("data-reward-card=\"OPEN\"");
      expect(page).toContain("150.50 دينار");
      expect(page).toContain("ملاحظة-مكافأة-٩٩");
      expect(page).toContain("هالمهمة بمكافأة: بس المالك بيعدّلها.");
      expect(page).toContain("المكافأة بتنصرف من الرواتب، هون تسجيل واعتماد بس.");
      expect(page).not.toContain("عدّل المكافأة");
      expect(page).not.toContain("ألغِ المكافأة");
      expect(page).not.toContain("data-pin-button");
      // the title is plain text, not a box to type in
      expect(page).toMatch(/<h1[^>]*>مهمة بمكافأة<\/h1>/);
    }
  });

  it("the owner gets the controls and the title box; a finished task shows «بانتظار اعتماد المكافأة» with the assignee to pick", async () => {
    const w = await world();
    const task = await w.rewardTask("مهمة المالك");
    await loginAs(w.owner.id);
    let page = await taskPage(task.id);
    expect(page).toContain("عدّل المكافأة");
    expect(page).toContain("ألغِ المكافأة");
    expect(page).toContain('data-pin-button="unpinned"');
    expect(page).not.toMatch(/<h1[^>]*>مهمة المالك<\/h1>/);
    expect(page).not.toContain("data-reward-pending");

    await db.task.update({ where: { id: task.id }, data: { completedAt: new Date(), columnId: w.made.done.id } });
    page = await taskPage(task.id);
    expect(page).toContain("data-reward-pending");
    expect(page).toContain("بانتظار اعتماد المكافأة");
    expect(page).toContain("اعتمد المكافأة لـ Member");
    // reading as the owner leaves no trace: he is still in no space
    expect(await db.workspaceMember.count({ where: { userId: w.owner.id } })).toBe(0);
  });

  it("the owner may add a reward to a plain task; a member sees no card there", async () => {
    const w = await world();
    const plain = await w.mk("عادية");
    await loginAs(w.owner.id);
    expect(await taskPage(plain.id)).toContain("data-reward-section");
    await loginAs(w.member.id);
    expect(await taskPage(plain.id)).not.toContain("data-reward-section");
  });

  it("the space's ADMIN has the pin button (and keeps the lock on a reward task: only the owner edits it)", async () => {
    const w = await world();
    const task = await w.rewardTask("للمدير");
    await loginAs(w.admin.id);
    const page = await taskPage(task.id);
    expect(page).toContain('data-pin-button="unpinned"');
    expect(page).toContain("هالمهمة بمكافأة: بس المالك بيعدّلها.");
    await db.task.update({ where: { id: task.id }, data: { pinnedAt: new Date(), pinnedById: w.admin.id } });
    expect(await taskPage(task.id)).toContain('data-pin-button="pinned"');
  });

  it("switched off: nothing of it is drawn for anybody and the task is a plain task again (the title is a box for the member)", async () => {
    const w = await world();
    const task = await w.rewardTask("بدون ميزة");
    await loginAs(w.owner.id);
    await call(featuresRoute.PATCH, { method: "PATCH", body: { key: "taskRewards", on: false } });
    for (const who of [w.owner, w.admin, w.member]) {
      await loginAs(who.id);
      const page = await taskPage(task.id);
      for (const word of ["data-reward", "150.50", "data-pin-button"]) expect(page, `${who.name}: ${word}`).not.toContain(word);
    }
    await loginAs(w.member.id);
    expect(await taskPage(task.id)).not.toMatch(/<h1[^>]*>بدون ميزة<\/h1>/);
  });
});

describe("the list, the board and the project", () => {
  it("the list: a partner sees no badge and no chip; a member sees the badge and the chip; the filter keeps only reward tasks", async () => {
    const w = await world();
    await w.rewardTask("بمكافأة ظاهرة");
    await w.mk("عادية جدًا");
    await loginAs(w.guest.id);
    const guest = await listPage();
    expect(guest).toContain("بمكافأة ظاهرة");
    for (const word of ["data-reward", "🏆", "150.50", "المهام بمكافأة"]) expect(guest, word).not.toContain(word);
    // even asking for the filter by hand does not narrow a partner's list
    expect(await listPage({ reward: "1" })).toContain("عادية جدًا");

    await loginAs(w.member.id);
    const member = await listPage();
    expect(member).toContain("data-reward-badge");
    expect(member).toContain("🏆 مكافأة 150.50 دينار");
    expect(member).toContain("data-reward-filter");
    expect(member).not.toContain("data-reward-totals"); // the owner's alone
    const only = await listPage({ reward: "1" });
    expect(only).toContain("بمكافأة ظاهرة");
    expect(only).not.toContain("عادية جدًا");
  });

  it("the owner's header adds the open rewards per currency; pinned tasks come first", async () => {
    const w = await world();
    await w.rewardTask("بالدينار", { rewardAmountMinor: 10, rewardCurrency: "JOD" });
    await w.rewardTask("بالدينار ٢", { rewardAmountMinor: 20, rewardCurrency: "JOD" });
    await w.rewardTask("باليورو", { rewardAmountMinor: 500000, rewardCurrency: "EUR" });
    const late = await w.mk("مثبّتة متأخرة", { dueDate: new Date(Date.now() + 30 * DAY) });
    await db.task.update({ where: { id: late.id }, data: { pinnedAt: new Date() } });
    await loginAs(w.owner.id);
    const page = await listPage({ group: "priority" });
    expect(page).toContain("data-reward-totals");
    expect(page).toContain("مجموع المكافآت المفتوحة");
    expect(page).toContain("0.30 دينار (2)");
    expect(page).toContain("5,000 يورو (1)");
    // pinned first inside its group, ahead of tasks due sooner
    expect(page.indexOf("مثبّتة متأخرة")).toBeGreaterThan(-1);
    expect(page.indexOf("مثبّتة متأخرة")).toBeLessThan(page.indexOf("بالدينار"));
  });

  it("the board: the card shows the badge to a member, nothing to a partner", async () => {
    const w = await world();
    await w.rewardTask("على اللوحة");
    const board = (id: string) => html(BoardPage({ params: { id } }));
    await loginAs(w.member.id);
    expect(await board(w.made.board.id)).toContain("🏆 مكافأة 150.50 دينار");
    await loginAs(w.guest.id);
    const guest = await board(w.made.board.id);
    expect(guest).toContain("على اللوحة");
    for (const word of ["🏆", "150.50", "data-reward"]) expect(guest, word).not.toContain(word);
  });

  it("the project page opens with the pinned strip (a member reads it; a partner gets none), and «اليوم» a compact card", async () => {
    const w = await world();
    const task = await w.rewardTask("مثبّتة بالمشروع");
    await db.task.update({ where: { id: task.id }, data: { pinnedAt: new Date(), pinnedById: w.owner.id } });
    const project = (id: string) => html(ProjectPage({ params: { id } }));
    await loginAs(w.member.id);
    const page = await project(w.made.project.id);
    expect(page).toContain('data-pinned-strip="strip"');
    expect(page).toContain("مثبّتة بالمشروع");
    expect(page).toContain("🏆 مكافأة 150.50 دينار");
    // «اليوم» draws the same cards from the same call (the page itself holds async children: the call is read here)
    const asMember = { userId: w.member.id, orgId: w.org.id };
    const onToday = await pinnedTasks(asMember, { spaceId: w.ws.id }, await rewardLensFor(asMember, w.ws.id));
    expect(onToday.map((c) => c.id)).toEqual([task.id]);
    expect(onToday[0]!.reward).toEqual({ status: "OPEN", amountMinor: 15050, currency: "JOD" });

    await loginAs(w.guest.id);
    expect(await project(w.made.project.id)).not.toContain("data-pinned-strip");
    const asGuest = { userId: w.guest.id, orgId: w.org.id };
    expect(await pinnedTasks(asGuest, { spaceId: w.ws.id }, await rewardLensFor(asGuest, w.ws.id))).toEqual([]);
    // the owner is shown them without being in the space
    const asOwner = { userId: w.owner.id, orgId: w.org.id };
    expect((await pinnedTasks(asOwner, { spaceId: w.ws.id }, await rewardLensFor(asOwner, w.ws.id))).map((c) => c.id)).toEqual([task.id]);
  });

  it("«مهامي»: a pinned task is first in its tab, and a partner's rows carry no reward", async () => {
    const w = await world();
    const early = await w.mk("مبكرة", { dueDate: new Date(Date.now() + DAY) });
    const pinned = await w.rewardTask("مثبّتة ومتأخرة", {}, { dueDate: new Date(Date.now() + 20 * DAY) });
    await db.task.update({ where: { id: pinned.id }, data: { pinnedAt: new Date() } });
    const mine = await getMyWork(w.member.id);
    expect(mine.mine.map((r) => r.task.id)).toEqual([pinned.id, early.id]);
    expect(mine.mine[0]!.task.reward).toEqual({ status: "OPEN", amountMinor: 15050, currency: "JOD" });
    // a person whose row in the space says GUEST has the same rows, with no reward on them
    const half = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Half" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: half.id, role: "GUEST" } });
    await db.task.update({ where: { id: pinned.id }, data: { assigneeId: half.id } });
    const theirs = await getMyWork(half.id);
    expect(JSON.stringify(theirs)).not.toMatch(/reward/i);
    // and the partner of the company is given none at all
    await db.task.update({ where: { id: pinned.id }, data: { assigneeId: w.guest.id } });
    expect(JSON.stringify(await getMyWork(w.guest.id))).not.toMatch(/reward/i);
  });
});
