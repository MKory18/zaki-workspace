import "./scoping-react";
import { createElement, isValidElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The pages call redirect() and notFound(); neither needs a running Next app here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/guide",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import GuidePage from "@/app/(app)/guide/page";
import GuideArticlePage from "@/app/(app)/guide/[slug]/page";
import { FirstStepsCard } from "@/components/guide/first-steps-card";
import { FirstStepsCardClient, OpenedGuideMark } from "@/components/guide/first-steps-client";
import { ARTICLES, findArticle } from "@/lib/guide/articles";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import { requireActor } from "@/server/policy/actor";
import { db, loginAs, logout, makeTeam, makeUser } from "./helpers";

const { t } = getServerT();
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;

async function html(page: Promise<ReactElement | null> | ReactElement | null): Promise<string> {
  const element = await page;
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, element));
}

const hrefs = (markup: string) => [...markup.matchAll(/href="(\/guide[^"]*)"/g)].map((m) => m[1]);

/** The first element of this component type anywhere in a page's tree (null when there is none). */
function findType(node: ReactNode, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findType(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  return findType((node.props as { children?: ReactNode }).children, type);
}

async function setMember(orgId: string, userId: string, data: Record<string, unknown>) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data });
}

/** makeTeam (owner, admin, member, guest) + a team lead. */
async function world() {
  const team = await makeTeam();
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead" });
  return { ...team, lead };
}

describe("/guide with real accounts: the index follows the rank and the switches", () => {
  it("an external partner gets the guest articles only, and none of the staff material", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const page = await html(GuidePage());
    const links = hrefs(page);
    for (const slug of ["start", "places", "spaces", "projects", "themes", "install", "privacy", "shortcuts"]) {
      expect(links, slug).toContain(`/guide/${slug}`);
    }
    for (const slug of ["tasks", "company", "team"]) expect(links, slug).not.toContain(`/guide/${slug}`);
    for (const word of ["المكتبة", "العملاء", "الملفات", "الصلاحيات", t("guide.badge.managers")]) expect(page, word).not.toContain(word);
  });

  it("a member and a team lead get the team's articles but not the people article", async () => {
    const w = await world();
    for (const person of [w.member, w.lead]) {
      await loginAs(person.id);
      const links = hrefs(await html(GuidePage()));
      expect(links, person.name).toContain("/guide/tasks");
      expect(links, person.name).toContain("/guide/company");
      expect(links, person.name).not.toContain("/guide/team");
    }
  });

  it("the owner and an admin get everything, the people article marked for those who manage accounts", async () => {
    const w = await world();
    for (const person of [w.owner, w.admin]) {
      await loginAs(person.id);
      const page = await html(GuidePage());
      expect(hrefs(page), person.name).toEqual(expect.arrayContaining(ARTICLES.map((a) => `/guide/${a.slug}`)));
      expect(page, person.name).toContain(t("guide.badge.managers"));
    }
  });

  it("the switch decides, not the rank: users.manage on gives a member the people article, off takes it from an admin", async () => {
    const w = await world();
    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    await loginAs(w.member.id);
    expect(hrefs(await html(GuidePage()))).toContain("/guide/team");
    await setMember(w.org.id, w.admin.id, { revokedCapabilities: ["users.manage"] });
    await loginAs(w.admin.id);
    expect(hrefs(await html(GuidePage()))).not.toContain("/guide/team");
  });

  it("remembers, on the person's own device, that the guide was opened (the mark carries their own id)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const mark = findType(await GuidePage(), OpenedGuideMark);
    expect(mark).not.toBeNull();
    expect((mark?.props as { userId: string }).userId).toBe(w.member.id);
  });
});

describe("/guide/[slug] with real accounts: a typed link cannot read what the guide does not offer", () => {
  it("the people article is a 404 for an external partner, a team lead and a member, and opens for an admin and the owner", async () => {
    const w = await world();
    for (const person of [w.guest, w.member, w.lead]) {
      await loginAs(person.id);
      await expect(GuideArticlePage({ params: { slug: "team" } }), person.name).rejects.toThrow("NEXT_NOT_FOUND");
    }
    for (const person of [w.admin, w.owner]) {
      await loginAs(person.id);
      expect(await html(GuideArticlePage({ params: { slug: "team" } })), person.name).toContain(findArticle("team")!.title);
    }
  });

  it("a guest cannot open the task, company or people articles by typing the link, but reads the shared ones", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    for (const slug of ["tasks", "company", "team", "no-such-article"]) {
      await expect(GuideArticlePage({ params: { slug } }), slug).rejects.toThrow("NEXT_NOT_FOUND");
    }
    for (const slug of ["start", "places", "spaces", "projects", "ideas-goals", "themes", "install", "privacy", "shortcuts"]) {
      expect(await html(GuideArticlePage({ params: { slug } })), slug).toContain(findArticle(slug)!.title);
    }
  });

  it("a shared article reads differently to a guest and to the team (the library and private DMs are the team's; the chat is everyone's)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const staff = await html(GuideArticlePage({ params: { slug: "places" } }));
    await loginAs(w.guest.id);
    const guest = await html(GuideArticlePage({ params: { slug: "places" } }));
    expect(staff).toContain("المكتبة");
    expect(staff).toContain("«خاص»");
    expect(guest).not.toContain("المكتبة");
    expect(guest).not.toContain("«خاص»");
    expect(guest).toContain("الدردشة");
  });
});

describe("the guide pages and the session", () => {
  it("send a visitor who is not signed in to login", async () => {
    logout();
    await expect(GuidePage()).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(GuideArticlePage({ params: { slug: "start" } })).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("send a suspended person (stale cookie) to login", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await setMember(w.org.id, w.member.id, { status: "SUSPENDED" });
    await db.user.update({ where: { id: w.member.id }, data: { tokenVersion: { increment: 1 } } });
    await expect(GuidePage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("send a person who still owes the temporary-password change to onboarding", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.member.id }, data: { mustChangePassword: true } });
    await loginAs(w.member.id, { mcp: true });
    await expect(GuidePage()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
  });
});

describe("FirstStepsCard: the server wrapper the Today page mounts", () => {
  it("hands the browser part the person's own steps and id, computed from their rows", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const actor = await requireActor();
    const card = (await FirstStepsCard({ actor })) as ReactElement<{ userId: string; steps: { id: string; done: boolean }[] }>;
    expect(card.type).toBe(FirstStepsCardClient);
    expect(card.props.userId).toBe(w.member.id);
    expect(card.props.steps.map((s) => s.id)).toEqual(["install", "theme", "first-message", "first-task", "finish-task", "open-guide"]);
    expect(card.props.steps.every((s) => !s.done)).toBe(true);
  });

  it("finds the signed-in person itself when the page does not pass the actor", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const card = (await FirstStepsCard({})) as ReactElement<{ userId: string; steps: { id: string }[] }>;
    expect(card.props.userId).toBe(w.owner.id);
    expect(card.props.steps.map((s) => s.id)).toContain("add-person");
  });

  it("gives an external partner only the steps that apply to them", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const card = (await FirstStepsCard({ actor: await requireActor() })) as ReactElement<{ steps: { id: string }[] }>;
    expect(card.props.steps.map((s) => s.id)).toEqual(["install", "theme", "open-guide"]);
  });

  it("is drawn in the FIRST HTML from the zk-fs cookie, so the task list never jumps after load", async () => {
    const w = await world();
    await loginAs(w.member.id);
    // 01-FIX-WAVE-BRIEFS item 1(a): the card used to render null until an effect read localStorage, which
    // pushed the tasks 100-300px down right after load. The open/collapsed/hidden state lives in a cookie
    // read by the server, so the first HTML already carries the card (see tests/shell-cookie-state.test.ts).
    const open = await html(FirstStepsCard({ actor: await requireActor() }));
    expect(open).toContain('data-tour="first-steps"');

    // and a dismissed card is absent from the first HTML too — no flash of a card the person hid
    (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set("zk-fs", "hidden");
    const hidden = await html(FirstStepsCard({ actor: await requireActor() }));
    expect(hidden).toBe("");
  });
});
