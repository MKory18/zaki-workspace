import "./scoping-react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The pages call redirect() and their client rows call useRouter(); neither needs a running Next app here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import MyWorkPage from "@/app/(app)/my-work/page";
import ListPage from "@/app/(app)/list/page";
import CalendarPage from "@/app/(app)/calendar/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import { ToastProvider } from "@/components/ui/toast";
import { db, loginAs, logout, makeUser } from "./helpers";
import { joinWorkspace, makeScopedOrg, seedWork, todayNoon } from "./scoping-helpers";

// the providers' `children` is typed as required, which createElement(type, props, child) cannot express
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

/** Renders a server page (with the client providers its rows need) to HTML. */
async function html(page: Promise<ReactElement> | ReactElement): Promise<string> {
  const element = await page;
  return renderToStaticMarkup(
    createElement(Translations, { initial: "ar" }, createElement(Toasts, null, element)),
  );
}

const { t } = getServerT();

describe("My Work page: renders only what getMyWork returns", () => {
  it("shows my assigned tasks and none of a colleague's or of a workspace I am not in", async () => {
    const f = await makeScopedOrg();
    const mk = (label: string, workspaceId: string, extra: Partial<Parameters<typeof seedWork>[0]> = {}) =>
      seedWork({ orgId: f.org.id, workspaceId, token: f.token, label, creatorId: f.owner.id, ...extra });
    await mk("mine-visible", f.wsIn.id, { assigneeId: f.member.id });
    await mk("theirs-visible", f.wsIn.id, { assigneeId: f.admin.id });
    await mk("mine-hidden", f.wsOut.id, { assigneeId: f.member.id });

    await loginAs(f.member.id);
    const page = await html(MyWorkPage({ searchParams: { tab: "mine" } }));
    expect(page).toContain(`${f.token} task mine-visible`);
    expect(page).not.toContain(`${f.token} task theirs-visible`);
    expect(page).not.toContain(`${f.token} task mine-hidden`);
    // the same page for the admin (who can open every workspace) still only lists the admin's own work
    await loginAs(f.admin.id);
    const adminPage = await html(MyWorkPage({ searchParams: { tab: "mine" } }));
    expect(adminPage).toContain(`${f.token} task theirs-visible`);
    expect(adminPage).not.toContain(`${f.token} task mine-visible`);
    expect(adminPage).not.toContain(`${f.token} task mine-hidden`);
  });

  it("an unknown tab falls back to today, and the empty state shows when there is nothing", async () => {
    const f = await makeScopedOrg();
    const loner = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await loginAs(loner.id);
    const page = await html(MyWorkPage({ searchParams: { tab: "nope" } }));
    expect(page).toContain(t("mywork.empty"));
    expect(page).toContain(t("mywork.tab.today"));
  });

  it("sends an anonymous visitor to login", async () => {
    logout();
    await expect(MyWorkPage({ searchParams: {} })).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("List page: only workspaces the user can open", () => {
  it("a MEMBER's selector and rows never include a workspace they are not in, even when asked by id", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.member.id);
    const page = await html(ListPage({ searchParams: { workspace: f.wsOut.id } }));
    expect(page).toContain(`${f.token} task in`);
    expect(page).not.toContain(`${f.token} task out`);
    expect(page).toContain(f.wsIn.name);
    expect(page).not.toContain(f.wsOut.name);
  });

  it("an ADMIN can open any workspace of the org", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.admin.id);
    const page = await html(ListPage({ searchParams: { workspace: f.wsOut.id } }));
    expect(page).toContain(`${f.token} task out`);
    expect(page).not.toContain(`${f.token} task in`);
    expect(page).toContain(f.wsIn.name);
    expect(page).toContain(f.wsOut.name);
  });

  it("a member of no workspace gets the 'no workspace' state, not someone else's tasks", async () => {
    const f = await makeScopedOrg();
    const loner = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await loginAs(loner.id);
    const page = await html(ListPage({ searchParams: {} }));
    expect(page).toContain(t("list.noWorkspace"));
    expect(page).not.toContain(f.token);
  });

  it("a GUEST's assignee choices stay inside their workspace", async () => {
    const f = await makeScopedOrg();
    await joinWorkspace(f.guest.id, f.wsIn.id, "GUEST");
    await loginAs(f.guest.id);
    const page = await html(ListPage({ searchParams: {} }));
    expect(page).toContain(`${f.token} task in`);
    expect(page).toContain(">Member<"); // shares the workspace
    expect(page).not.toContain(">Owner<");
    expect(page).not.toContain(">Admin<");
  });
});

describe("Calendar page: only workspaces the user can open", () => {
  it("a MEMBER asking for another workspace gets their own workspace's calendar", async () => {
    const f = await makeScopedOrg();
    const now = new Date();
    const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 12));
    const month = due.toISOString().slice(0, 7);
    await seedWork({ orgId: f.org.id, workspaceId: f.wsIn.id, token: f.token, label: "cal-in", creatorId: f.owner.id, dueDate: due });
    await seedWork({ orgId: f.org.id, workspaceId: f.wsOut.id, token: f.token, label: "cal-out", creatorId: f.owner.id, dueDate: due });

    await loginAs(f.member.id);
    const page = await html(CalendarPage({ searchParams: { workspace: f.wsOut.id, month } }));
    expect(page).toContain(`${f.token} task cal-in`);
    expect(page).not.toContain(`${f.token} task cal-out`);

    await loginAs(f.admin.id);
    const adminPage = await html(CalendarPage({ searchParams: { workspace: f.wsOut.id, month } }));
    expect(adminPage).toContain(`${f.token} task cal-out`);
    expect(adminPage).not.toContain(`${f.token} task cal-in`);
  });

  it("a member of no workspace sees the 'no workspace' state", async () => {
    const f = await makeScopedOrg();
    const loner = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await loginAs(loner.id);
    expect(await html(CalendarPage({ searchParams: {} }))).toContain(t("list.noWorkspace"));
  });
});

describe("Analytics page: this organization and the workspaces the user can open", () => {
  it("counts the user's own workspaces and the org's ideas, never another org's", async () => {
    const f = await makeScopedOrg();
    const other = await makeScopedOrg();
    for (const org of [f.org.id, f.org.id, other.org.id, other.org.id, other.org.id]) {
      await db.idea.create({ data: { orgId: org, creatorId: org === f.org.id ? f.owner.id : other.owner.id, title: "An idea" } });
    }
    await loginAs(f.member.id);
    const page = await html(AnalyticsPage());
    expect(page).toContain(t("analytics.statWorkspaces", { n: 1 }));
    expect(page).toContain(t("analytics.statProjects", { n: 1 }));
    expect(page).toContain(t("analytics.ideasTotal", { total: 2 }));
    expect(page).not.toContain(t("analytics.ideasTotal", { total: 5 }));

    await loginAs(f.admin.id);
    const adminPage = await html(AnalyticsPage());
    expect(adminPage).toContain(t("analytics.statWorkspaces", { n: 2 }));
    expect(adminPage).toContain(t("analytics.ideasTotal", { total: 2 }));
  });
});
