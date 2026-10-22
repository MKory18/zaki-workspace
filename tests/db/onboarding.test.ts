import "./scoping-react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Server pages call redirect(); it throws in Next as well, so a test can catch where it points.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import * as meRoute from "@/app/api/me/route";
import * as passwordRoute from "@/app/api/me/password/route";
import * as logoutRoute from "@/app/api/auth/logout/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as conversationsRoute from "@/app/api/chat/conversations/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import AppLayout from "@/app/(app)/layout";
import { verifyPassword } from "@/server/auth";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import { call, db, loginAs, logout, makeTeam, makeWorkspace, TEST_PASSWORD } from "./helpers";
import { pendingMember, sessionClaims, sessionCookie, setSessionCookie } from "./login-helpers";

// New modules of this phase are imported where they are used, so each test names what it needs.
const transparencyRoute = () => import("@/app/api/me/transparency/route");
const onboardingPage = async () => (await import("@/app/onboarding/page")).default;

const NEW_PASSWORD = "My-own-pass1";
const { t } = getServerT();

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
async function html(page: Promise<ReactElement> | ReactElement): Promise<string> {
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, await page));
}

/** Where a server component redirected to (null = it rendered). */
async function redirectOf(render: () => Promise<unknown>): Promise<string | null> {
  try {
    await render();
    return null;
  } catch (err) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec(err instanceof Error ? err.message : "");
    if (!m) throw err;
    return m[1] ?? "";
  }
}

beforeEach(() => logout());

describe("somebody who has not finished the onboarding", () => {
  for (const owes of [{ password: true }, { notice: true }] as const) {
    const label = "password" in owes ? "a temporary password" : "the notice";
    it(`cannot use the normal API while they owe ${label} (tasks, chat, workspaces: 403 auth.onboarding_required)`, async () => {
      const { org, member } = await pendingMember(owes);
      const ws = await makeWorkspace(org.id, [{ userId: member.id }]);
      const responses = [
        await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${ws.id}` }),
        await call(conversationsRoute.GET),
        await call(workspacesRoute.GET),
      ];
      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(res.json).toMatchObject({ error: "forbidden", message: "auth.onboarding_required" });
      }
    });
  }

  it("can read and edit their own profile, and sign out", async () => {
    const { member } = await pendingMember({ password: true, notice: true });
    const me = await call(meRoute.GET);
    expect(me.status).toBe(200);
    expect(me.json?.user).toMatchObject({ id: member.id, mustChangePassword: true, transparencyPending: true });

    expect((await call(meRoute.PATCH, { method: "PATCH", body: { name: "اسم جديد" } })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).name).toBe("اسم جديد");

    const out = await call(logoutRoute.POST, { method: "POST" });
    expect(out.status).toBe(200);
    expect(sessionCookie()).toBeUndefined();
    const audit = await db.auditLog.findFirst({ where: { action: "auth.logout", actorId: member.id } });
    expect(audit).not.toBeNull();
  });

  it("GET /api/me says there is nothing to do for somebody who is done", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const me = await call(meRoute.GET);
    expect(me.json?.user).toMatchObject({ mustChangePassword: false, transparencyPending: false });
  });
});

describe("POST /api/me/password", () => {
  it("anonymous callers get 401", async () => {
    const res = await call(passwordRoute.POST, { body: { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD } });
    expect(res.status).toBe(401);
  });

  it("a wrong current password is refused and changes nothing", async () => {
    const { member } = await pendingMember({ password: true });
    const res = await call(passwordRoute.POST, { body: { currentPassword: "Not-the-pass1", newPassword: NEW_PASSWORD } });
    expect(res.status).toBe(403);
    expect(res.json?.message).toBe("password.wrong_current");
    const row = await db.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.mustChangePassword).toBe(true);
    expect(await verifyPassword(TEST_PASSWORD, row.passwordHash)).toBe(true);
  });

  it("the new password must be 8+ characters with a letter and a digit, and differ from the current one", async () => {
    const { member } = await pendingMember({ password: true });
    for (const newPassword of ["Short1", "onlyletters", "1234567890", TEST_PASSWORD]) {
      const res = await call(passwordRoute.POST, { body: { currentPassword: TEST_PASSWORD, newPassword } });
      expect(res.status, newPassword).toBe(422);
    }
    const same = await call(passwordRoute.POST, { body: { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD } });
    expect(JSON.stringify(same.json)).toContain("onboarding.err_same");
    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).mustChangePassword).toBe(true);
  });

  it("sets the password, clears the flag, keeps THIS browser signed in and ends every other session", async () => {
    const { org, member } = await pendingMember({ password: true });
    const otherBrowser = sessionCookie() as string;
    const tvBefore = (await db.user.findUniqueOrThrow({ where: { id: member.id } })).tokenVersion;

    const res = await call(passwordRoute.POST, { body: { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD } });
    expect(res.status).toBe(200);

    const row = await db.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.mustChangePassword).toBe(false);
    expect(row.tokenVersion).toBe(tvBefore + 1);
    expect(await verifyPassword(NEW_PASSWORD, row.passwordHash)).toBe(true);

    // this browser got a fresh cookie that no longer asks for a password change...
    const thisBrowser = sessionCookie() as string;
    expect(thisBrowser).not.toBe(otherBrowser);
    expect(await sessionClaims()).toEqual({ userId: member.id, tv: tvBefore + 1 });
    expect((await call(meRoute.GET)).status).toBe(200);
    expect((await call(workspacesRoute.GET)).status).toBe(200);
    // ...and a cookie minted before the change (another phone, a stolen copy) is dead
    setSessionCookie(otherBrowser);
    expect((await call(meRoute.GET)).status).toBe(401);

    const audit = await db.auditLog.findFirst({ where: { action: "auth.password_changed", actorId: member.id } });
    expect(audit).toMatchObject({ orgId: org.id });
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
  });

  it("guessing the current password through a stolen session is cut off after ten wrong tries", async () => {
    await pendingMember({ password: true });
    for (let i = 0; i < 10; i++) {
      expect((await call(passwordRoute.POST, { body: { currentPassword: `Wrong-${i}-pass`, newPassword: NEW_PASSWORD } })).status).toBe(403);
    }
    const blocked = await call(passwordRoute.POST, { body: { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("POST /api/me/transparency", () => {
  it("anonymous callers get 401", async () => {
    const { POST } = await transparencyRoute();
    expect((await call(POST, { body: { accept: true } })).status).toBe(401);
  });

  it("records the organization's CURRENT notice version and the date, and signs the browser in without the flag", async () => {
    const { org, member } = await pendingMember({ notice: true });
    await db.organization.update({ where: { id: org.id }, data: { settings: { transparencyVersion: 3 } } });
    const { POST } = await transparencyRoute();

    const res = await call(POST, { body: { accept: true } });
    expect(res.status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.transparencyVersion).toBe(3);
    expect(row.transparencyAcceptedAt).toBeInstanceOf(Date);
    expect(await sessionClaims()).toEqual({ userId: member.id, tv: row.tokenVersion });
    expect((await call(workspacesRoute.GET)).status).toBe(200);

    const audit = await db.auditLog.findMany({ where: { action: "auth.transparency_accepted", actorId: member.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ orgId: org.id, meta: { version: 3 } });
  });

  it("accepting again keeps the first date and writes no second record", async () => {
    const { member } = await pendingMember({ notice: true });
    const { POST } = await transparencyRoute();
    await call(POST, { body: { accept: true } });
    const first = (await db.user.findUniqueOrThrow({ where: { id: member.id } })).transparencyAcceptedAt;
    await new Promise((r) => setTimeout(r, 15));
    expect((await call(POST, { body: { accept: true } })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).transparencyAcceptedAt).toEqual(first);
    expect(await db.auditLog.count({ where: { action: "auth.transparency_accepted", actorId: member.id } })).toBe(1);
  });

  it("anything but { accept: true } records nothing", async () => {
    const { member } = await pendingMember({ notice: true });
    const { POST } = await transparencyRoute();
    for (const body of [{ accept: false }, {}, { accept: "yes" }]) {
      expect((await call(POST, { body })).status).toBe(422);
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).transparencyVersion).toBeNull();
  });

  it("works while a temporary password is still unchanged (the routes of the onboarding allow pending people)", async () => {
    await pendingMember({ password: true, notice: true });
    const { POST } = await transparencyRoute();
    expect((await call(POST, { body: { accept: true } })).status).toBe(200);
    // still owes the password: the new cookie keeps saying so
    expect(await sessionClaims()).toMatchObject({ mcp: true });
    expect((await sessionClaims())?.tp).toBeUndefined();
  });
});

describe("the /onboarding page", () => {
  it("sends anonymous visitors to /login", async () => {
    const Page = await onboardingPage();
    expect(await redirectOf(() => Page({ searchParams: {} }))).toBe("/login");
  });

  it("sends somebody with nothing to do to where they were going — a path on this site only", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const Page = await onboardingPage();
    expect(await redirectOf(() => Page({ searchParams: {} }))).toBe("/");
    expect(await redirectOf(() => Page({ searchParams: { next: "/projects?tab=board" } }))).toBe("/projects?tab=board");
    for (const evil of ["//evil.example", "/\\evil.example", "https://evil.example/x", "/.//evil.example", "javascript:alert(1)"]) {
      expect(await redirectOf(() => Page({ searchParams: { next: evil } })), evil).toBe("/");
    }
  });

  it("asks for a new password (and the notice) when both are owed", async () => {
    await pendingMember({ password: true, notice: true });
    const Page = await onboardingPage();
    const page = await html(Page({ searchParams: { next: "/projects" } }));
    expect(page).toContain(t("onboarding.password_title"));
    expect(page).toContain('name="currentPassword"');
    expect(page).toContain('name="confirmPassword"');
    expect(page).toContain(t("onboarding.step", { current: 1, total: 2 }));
    expect(page).not.toContain("NEXT_REDIRECT");
  });

  it("shows only the notice, with one button, when only the notice is owed", async () => {
    await pendingMember({ notice: true });
    const Page = await onboardingPage();
    const page = await html(Page({ searchParams: {} }));
    expect(page).toContain(t("onboarding.notice_title"));
    expect(page).toContain(t("onboarding.notice_kept"));
    expect(page).toContain(t("onboarding.notice_accept"));
    expect(page).not.toContain('name="currentPassword"');
  });

  it("does not bounce back to the app while the cookie still says 'pending' (that would loop through the middleware)", async () => {
    const { member } = await makeTeam();
    // the notice was accepted on another device: the database is done, this browser's cookie is not
    await loginAs(member.id, { tp: true });
    const Page = await onboardingPage();
    expect(await redirectOf(() => Page({ searchParams: {} }))).toBeNull();
    // and accepting again (what the page does on its own) refreshes the cookie without touching the record
    const { POST } = await transparencyRoute();
    const before = (await db.user.findUniqueOrThrow({ where: { id: member.id } })).transparencyAcceptedAt;
    expect((await call(POST, { body: { accept: true } })).status).toBe(200);
    expect((await sessionClaims())?.tp).toBeUndefined();
    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).transparencyAcceptedAt).toEqual(before);
  });
});

describe("the app layout (defence in depth behind the middleware)", () => {
  it("sends anonymous visitors to /login", async () => {
    expect(await redirectOf(() => AppLayout({ children: null }))).toBe("/login");
  });

  it("sends a pending person to /onboarding even when the cookie does not say so", async () => {
    const { org, member } = await makeTeam();
    await loginAs(member.id); // cookie issued while nothing was pending
    expect(await redirectOf(() => AppLayout({ children: null }))).toBeNull();
    // the owner raises the notice version afterwards
    await db.organization.update({ where: { id: org.id }, data: { settings: { transparencyVersion: 2 } } });
    expect(await redirectOf(() => AppLayout({ children: null }))).toBe("/onboarding");
  });

  it("sends somebody with a temporary password to /onboarding", async () => {
    await pendingMember({ password: true });
    expect(await redirectOf(() => AppLayout({ children: null }))).toBe("/onboarding");
  });

  it("decides 'external partner' from the ACTIVE membership, not from an old seat that was closed", async () => {
    const a = await makeTeam();
    const b = await makeTeam();
    // b's member was once a guest of organization A; that seat was closed long ago
    await db.organizationMember.create({
      data: { organizationId: a.org.id, userId: b.member.id, role: "GUEST", status: "OFFBOARDED", createdAt: new Date("2020-01-01") },
    });
    await loginAs(b.member.id);
    const shell = (await AppLayout({ children: null })) as { props: { isGuest: boolean } };
    expect(shell.props.isGuest).toBe(false);
  });
});
