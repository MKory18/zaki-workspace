import "./scoping-react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/spaces/current",
  useSearchParams: () => new URLSearchParams(),
}));

import AppLayout from "@/app/(app)/layout";
import CurrentSpacePage from "@/app/(app)/spaces/current/page";
import ProjectsPage from "@/app/(app)/projects/page";
import type { AppShellProps } from "@/components/app-shell";
import { AR } from "@/lib/i18n/dict";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { db, loginAs, logout, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { html } from "./pages-access-helpers";

/**
 * «الإدارة» > «المساحة»: «تعديل المساحة» and «أعضاء المساحة» moved here from the projects page (the owner's ask,
 * 2026-10-30). The tab and the page are for whoever MANAGES the space they are in — decided on the server from the
 * database (the owner, the space's ADMIN, an org ADMIN who is in it) — and for nobody else.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
const t = (key: string) => AR[key] as string;

async function world() {
  const team = await makeTeam();
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead" });
  const outsider = await makeUser({ orgId: team.org.id, role: "ADMIN", name: "Outside Admin" });
  const space = await makeWorkspace(
    team.org.id,
    [
      { userId: team.admin.id, role: "MEMBER" }, // an org ADMIN in the space manages it by rank
      { userId: lead.id, role: "ADMIN" }, // the space's own ADMIN
      { userId: team.member.id, role: "MEMBER" },
      { userId: team.guest.id, role: "GUEST" },
    ],
    "Secret Launch Space",
  );
  return { ...team, lead, outsider, space };
}
type World = Awaited<ReturnType<typeof world>>;

async function shellOf(w: World, userId: string, spaceId: string): Promise<AppShellProps> {
  await loginAs(userId);
  enter(spaceId);
  return ((await AppLayout({ children: null })) as ReactElement<AppShellProps>).props;
}
const adminTabs = (shell: AppShellProps) => shell.nav.places.find((p) => p.key === "admin")?.tabs.map((x) => x.key);

async function pageHtml(userId: string, spaceId: string): Promise<string> {
  await loginAs(userId);
  enter(spaceId);
  return html(CurrentSpacePage());
}

beforeEach(() => logout());

describe("the «المساحة» tab is drawn for whoever manages the space they are in", () => {
  it("the owner (no row), the space's ADMIN and an org ADMIN who is in the space get it; «الإدارة» is the last place", async () => {
    const w = await world();
    for (const who of [w.owner, w.lead, w.admin]) {
      const shell = await shellOf(w, who.id, w.space.id);
      expect(adminTabs(shell), who.name).toContain("space");
      expect(shell.nav.places.at(-1)?.key, who.name).toBe("admin");
    }
  });

  it("a plain member of the space, an ADMIN who is not in it and an external partner do not", async () => {
    const w = await world();
    expect(adminTabs(await shellOf(w, w.member.id, w.space.id))).not.toContain("space");
    // not in the space: their cookie falls back to a space they may open, and they manage nothing there
    expect(adminTabs(await shellOf(w, w.outsider.id, w.space.id))).not.toContain("space");
    const guest = await shellOf(w, w.guest.id, w.space.id);
    expect(guest.nav.places.some((p) => p.key === "admin")).toBe(false);
  });

  it("follows the database on every request: demoted from the space's ADMIN, the tab is gone", async () => {
    const w = await world();
    expect(adminTabs(await shellOf(w, w.lead.id, w.space.id))).toContain("space");
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.space.id, userId: w.lead.id } }, data: { role: "MEMBER" } });
    expect(adminTabs(await shellOf(w, w.lead.id, w.space.id))).not.toContain("space");
  });
});

describe("the page: «تعديل المساحة» and «أعضاء المساحة», for a manager only", () => {
  it("the owner, the space's ADMIN and an org ADMIN in it see the space's name and both buttons", async () => {
    const w = await world();
    for (const who of [w.owner, w.lead, w.admin]) {
      const page = await pageHtml(who.id, w.space.id);
      expect(page, who.name).toContain("Secret Launch Space");
      expect(page, who.name).toContain(t("ws.edit"));
      expect(page, who.name).toContain(t("ws.members"));
    }
  });

  it("a plain member is refused with a plain notice and is told nothing about the space", async () => {
    const w = await world();
    const page = await pageHtml(w.member.id, w.space.id);
    expect(page).toContain(t("spaces.manage.not_yours"));
    expect(page).not.toContain("Secret Launch Space");
    expect(page).not.toContain(t("ws.edit"));
    expect(page).not.toContain(t("ws.members"));
  });

  it("an external partner is refused the same way, and an ADMIN who is not in the space sees nothing of it", async () => {
    const w = await world();
    for (const who of [w.guest, w.outsider]) {
      const page = await pageHtml(who.id, w.space.id);
      // the guest is in the space and is told it is not theirs to manage; the outsider has no space open at all
      expect(page, who.name).toContain(who === w.guest ? t("spaces.manage.not_yours") : t("spaces.manage.none"));
      expect(page, who.name).not.toContain("Secret Launch Space");
      expect(page, who.name).not.toContain(t("ws.edit"));
    }
  });
});

describe("the projects page no longer carries the two entries for a manager (it was moved, not removed)", () => {
  it("the manager's projects page has neither button; «المقاطع» stays, and a plain member keeps the read-only people list", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    enter(w.space.id);
    const managerPage = await html(ProjectsPage({ searchParams: {} }));
    expect(managerPage).not.toContain(t("ws.edit"));
    expect(managerPage).not.toContain(t("ws.members"));
    expect(managerPage).toContain(t("spaceteams.title"));

    await loginAs(w.member.id);
    enter(w.space.id);
    const memberPage = await html(ProjectsPage({ searchParams: {} }));
    expect(memberPage).toContain(t("ws.members"));
    expect(memberPage).not.toContain(t("ws.edit"));
  });
});
