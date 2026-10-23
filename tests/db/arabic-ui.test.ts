import "./scoping-react";
import type { ReactElement } from "react";
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

import CrmPage from "@/app/(app)/crm/page";
import TaskPage from "@/app/(app)/tasks/[id]/page";
import ProjectsPage from "@/app/(app)/projects/page";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import BoardPage from "@/app/(app)/boards/[id]/page";
import ListPage from "@/app/(app)/list/page";
import * as boardsRoute from "@/app/api/boards/route";
import { CrmView } from "@/components/crm-view";
import { TaskDetail } from "@/components/task-detail";
import { getServerT } from "@/lib/i18n/server";
import { DEFAULT_BOARD_COLUMNS } from "@/server/services/tasks";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { html as renderPage, setCapabilities, type PageElement } from "./pages-access-helpers";

/** Renders a page (some return null for an anonymous visitor: here somebody is always signed in). */
const html = (page: Promise<unknown> | unknown) => renderPage(page as Promise<ReactElement>);

const { t } = getServerT();
const ARABIC = /[؀-ۿ]/;

// ---------------------------------------------------------------------------
// the task page: edit controls follow the same rule as the API
// ---------------------------------------------------------------------------

type OrgRoleName = "owner" | "admin" | "lead" | "member" | "guest";

/** Renders /tasks/[id] for one person and returns what the page decided: may they change the task? */
async function taskCanEdit(
  orgRole: OrgRoleName,
  spaceRole: "ADMIN" | "MEMBER" | "GUEST" | null,
  opts: { creator?: boolean; assignee?: boolean } = {},
): Promise<boolean> {
  const team = await makeTeam();
  const user = orgRole === "lead" ? await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead" }) : team[orgRole];
  // only the OWNER inherits every space; everybody else is in the space (a row) or is not
  const space = await makeWorkspace(team.org.id, spaceRole ? [{ userId: user.id, role: spaceRole }] : []);
  const { project, board, todo } = await makeProject(space.id);
  const task = await makeTask({
    orgId: team.org.id,
    workspaceId: space.id,
    projectId: project.id,
    boardId: board.id,
    columnId: todo.id,
    creatorId: opts.creator ? user.id : team.owner.id,
    assigneeId: opts.assignee ? user.id : null,
  });
  await loginAs(user.id);
  const element = (await TaskPage({ params: { id: task.id } })) as PageElement;
  expect(element.type).toBe(TaskDetail);
  return element.props["canEdit"] as boolean;
}

describe("/tasks/[id]: the edit controls follow canWriteInWorkspace, like the board page and the API", () => {
  it("a member may edit; a space-guest row makes even a member or a lead read-only", async () => {
    expect(await taskCanEdit("member", "MEMBER")).toBe(true);
    expect(await taskCanEdit("member", "ADMIN")).toBe(true);
    expect(await taskCanEdit("member", "GUEST")).toBe(false);
    expect(await taskCanEdit("lead", "MEMBER")).toBe(true);
    expect(await taskCanEdit("lead", "GUEST")).toBe(false);
  });

  it("being the creator or the assignee of the task does not make a read-only person an editor (the server would refuse)", async () => {
    expect(await taskCanEdit("member", "GUEST", { creator: true })).toBe(false);
    expect(await taskCanEdit("member", "GUEST", { assignee: true })).toBe(false);
    expect(await taskCanEdit("member", "MEMBER", { creator: true })).toBe(true);
  });

  it("an org guest (an external partner) never edits, whatever the space row says", async () => {
    for (const row of ["ADMIN", "MEMBER", "GUEST"] as const) {
      expect(await taskCanEdit("guest", row), `row ${row}`).toBe(false);
      expect(await taskCanEdit("guest", row, { creator: true, assignee: true }), `row ${row}, creator and assignee`).toBe(false);
    }
  });

  it("the owner needs no row; an admin who is in the space outranks a lower row of their own", async () => {
    expect(await taskCanEdit("owner", null)).toBe(true);
    expect(await taskCanEdit("owner", "GUEST")).toBe(true);
    expect(await taskCanEdit("admin", "MEMBER")).toBe(true);
    expect(await taskCanEdit("admin", "GUEST")).toBe(true);
  });

  it("with no row, nobody but the owner can even open the task", async () => {
    for (const role of ["admin", "lead", "member"] as const) {
      await expect(taskCanEdit(role, null), role).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("a read-only viewer gets no comment box and no edit controls, only the words «للقراءة فقط»", async () => {
    const team = await makeTeam();
    const space = await makeWorkspace(team.org.id, [{ userId: team.member.id, role: "GUEST" }]);
    const { project, board, todo } = await makeProject(space.id);
    const task = await makeTask({ orgId: team.org.id, workspaceId: space.id, projectId: project.id, boardId: board.id, columnId: todo.id, creatorId: team.owner.id, title: "مهمة للعرض" });
    await db.taskComment.create({ data: { taskId: task.id, authorId: team.member.id, body: "تعليق قديم" } });
    await loginAs(team.member.id);
    const page = await html(TaskPage({ params: { id: task.id } }));
    expect(page).toContain(t("task.readOnly"));
    expect(page).toContain("مهمة للعرض");
    expect(page).not.toContain(`placeholder="${t("comment.placeholder")}"`);
    expect(page).not.toContain(`aria-label="${t("comment.edit")}"`);
    expect(page).not.toContain(`aria-label="${t("comment.delete")}"`);

    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: space.id, userId: team.member.id } }, data: { role: "MEMBER" } });
    const editable = await html(TaskPage({ params: { id: task.id } }));
    expect(editable).not.toContain(t("task.readOnly"));
    expect(editable).toContain(`placeholder="${t("comment.placeholder")}"`);
    expect(editable).toContain(`aria-label="${t("comment.edit")}"`);
  });
});

// ---------------------------------------------------------------------------
// the CRM page: crm.edit decides what the view offers
// ---------------------------------------------------------------------------

describe("/crm: the view is told whether the person may edit (crm.edit)", () => {
  async function canEditCrm(who: "owner" | "admin" | "lead" | "member", revoke: string[] = []): Promise<boolean> {
    const team = await makeTeam();
    const user = who === "lead" ? await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead" }) : team[who];
    if (revoke.length) await setCapabilities(team.org.id, user.id, { revoke });
    await loginAs(user.id);
    const element = (await CrmPage()) as PageElement;
    expect(element.type, who).toBe(CrmView);
    return element.props["canEdit"] as boolean;
  }

  it("every rank that may read may also edit by default", async () => {
    for (const who of ["owner", "admin", "lead", "member"] as const) expect(await canEditCrm(who), who).toBe(true);
  });

  it("switching crm.edit off keeps the page (they may read) but tells the view to hide the controls - an admin included", async () => {
    expect(await canEditCrm("member", ["crm.edit"])).toBe(false);
    expect(await canEditCrm("admin", ["crm.edit"])).toBe(false);
    expect(await canEditCrm("lead", ["crm.edit"])).toBe(false);
  });

  it("switching crm.view off still shows the notice, not the view", async () => {
    const team = await makeTeam();
    await setCapabilities(team.org.id, team.member.id, { revoke: ["crm.view"] });
    await loginAs(team.member.id);
    const element = (await CrmPage()) as PageElement;
    expect(element.type).not.toBe(CrmView);
    expect(await html(element)).toContain(t("access.section_off"));
  });
});

// ---------------------------------------------------------------------------
// the screens say it in Arabic
// ---------------------------------------------------------------------------

async function aWorkplace() {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }], "مساحة التصميم");
  const made = await makeProject(space.id, "مشروع الهوية");
  const task = await makeTask({
    orgId: team.org.id,
    workspaceId: space.id,
    projectId: made.project.id,
    boardId: made.board.id,
    columnId: made.todo.id,
    creatorId: team.owner.id,
    assigneeId: team.member.id,
    title: "تصميم الشعار",
    priority: "URGENT",
    dueDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
  });
  await db.project.update({ where: { id: made.project.id }, data: { status: "AT_RISK" } });
  await db.milestone.create({ data: { projectId: made.project.id, name: "تسليم أول", status: "OVERDUE", targetDate: new Date() } });
  const inProgress = await db.boardColumn.create({ data: { boardId: made.board.id, name: "In Progress", position: 2 } });
  await makeTask({
    orgId: team.org.id,
    workspaceId: space.id,
    projectId: made.project.id,
    boardId: made.board.id,
    columnId: inProgress.id,
    creatorId: team.owner.id,
    title: "مراجعة الألوان",
    priority: "LOW",
  });
  return { team, space, ...made, task };
}

const ENGLISH_LEFTOVERS = /\b(PLANNING|ACTIVE|ON_HOLD|AT_RISK|COMPLETED|OVERDUE|URGENT|NORMAL|LOW|HIGH|NONE|todo|done|In Progress|Unassigned|overdue|Boards|Milestones|Projects|tasks)\b/;

/** What a person can read or hear in the markup: the text between tags and the words of aria-label, title, placeholder and alt (not the links or class names). */
function readable(markup: string): string {
  const parts: string[] = [];
  for (const m of markup.matchAll(/>([^<>]+)</g)) parts.push(m[1] as string);
  for (const m of markup.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]*)"/g)) parts.push(m[1] as string);
  return parts.join("\n");
}

describe("the work screens show statuses, priorities and columns in Arabic", () => {
  it("the projects list and a project page: status, counts, due date, boards and milestones", async () => {
    const w = await aWorkplace();
    await loginAs(w.team.member.id);

    const list = await html(ProjectsPage({ searchParams: {} }));
    expect(list).toContain("مشروع الهوية");
    expect(list).toContain("في خطر"); // AT_RISK
    expect(list).toContain(t("proj.cardLine", { tasks: 2, boards: 1 }));
    expect(readable(list)).not.toMatch(ENGLISH_LEFTOVERS);

    const page = await html(ProjectPage({ params: { id: w.project.id } }));
    expect(page).toContain("في خطر");
    expect(page).toContain(t("proj.boards"));
    expect(page).toContain(t("proj.milestones"));
    expect(page).toContain("متأخر"); // the milestone's status (OVERDUE)
    expect(page).toContain("تسليم أول");
    expect(page).toContain(t("proj.progressLine", { open: 2, done: 0, pct: 0 }));
    expect(readable(page)).not.toMatch(ENGLISH_LEFTOVERS);
  });

  it("the board: the well-known English column names are shown in Arabic, the card's priority and due date too", async () => {
    const w = await aWorkplace();
    await loginAs(w.team.member.id);
    const page = await html(BoardPage({ params: { id: w.board.id } }));
    expect(page).toContain("للعمل"); // "todo"
    expect(page).toContain("قيد التنفيذ"); // "In Progress"
    expect(page).toContain("منتهي"); // "done"
    expect(page).toContain(`title="${t("priority.URGENT")}"`);
    expect(page).toContain(t("time.in.day.two")); // due in two days
    expect(page).toContain("تصميم الشعار");
    expect(readable(page)).not.toMatch(ENGLISH_LEFTOVERS);
  });

  it("a task: its column, its priority and its date", async () => {
    const w = await aWorkplace();
    await loginAs(w.team.member.id);
    const page = await html(TaskPage({ params: { id: w.task.id } }));
    expect(page).toContain("للعمل");
    expect(page).toContain(t("priority.URGENT"));
    expect(page).toContain(t("task.assignee"));
    expect(page).toContain(t("task.labels"));
    expect(readable(page)).not.toMatch(ENGLISH_LEFTOVERS);
  });

  it("the list grouped by priority or by column: group headings and filter options in Arabic", async () => {
    const w = await aWorkplace();
    await loginAs(w.team.member.id);

    const byPriority = await html(ListPage({ searchParams: { workspace: w.space.id, group: "priority" } }));
    expect(byPriority).toContain(t("priority.URGENT"));
    expect(byPriority).toContain(t("priority.LOW"));
    expect(byPriority).toContain(t("priority.NORMAL")); // the filter's options
    expect(readable(byPriority)).not.toMatch(ENGLISH_LEFTOVERS);

    const byColumn = await html(ListPage({ searchParams: { workspace: w.space.id, group: "status" } }));
    expect(byColumn).toContain("للعمل");
    expect(byColumn).toContain("قيد التنفيذ");
    expect(readable(byColumn)).not.toMatch(ENGLISH_LEFTOVERS);

    // the rows show the column the task is in, in Arabic, when the list is not grouped by column
    const byProject = await html(ListPage({ searchParams: { workspace: w.space.id, group: "project" } }));
    expect(byProject).toContain("قيد التنفيذ");
    expect(readable(byProject)).not.toMatch(ENGLISH_LEFTOVERS);
  });
});

// ---------------------------------------------------------------------------
// new boards start with Arabic columns
// ---------------------------------------------------------------------------

describe("POST /api/boards: a new board starts with the Arabic default columns", () => {
  it("creates the five steps in order, Arabic names, the last one marking 'done'", async () => {
    const team = await makeTeam();
    const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    const { project } = await makeProject(space.id);
    await loginAs(team.member.id);
    const res = await call(boardsRoute.POST, { body: { projectId: project.id, name: "لوحة الإطلاق" } });
    expect(res.status).toBe(201);
    const boardId = (res.json?.["board"] as { id: string }).id;
    const columns = await db.boardColumn.findMany({ where: { boardId }, orderBy: { position: "asc" } });
    expect(columns.map((c) => c.name)).toEqual(DEFAULT_BOARD_COLUMNS.map((c) => c.name));
    expect(columns.map((c) => c.done)).toEqual([false, false, false, false, true]);
    for (const column of columns) expect(column.name, column.name).toMatch(ARABIC);
    // and the board opens with those names as they are
    const page = await html(BoardPage({ params: { id: boardId } }));
    for (const column of columns) expect(page).toContain(column.name);
  });
});
