import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import * as registerRoute from "@/app/api/auth/register/route";
import * as joinCodeRoute from "@/app/api/organizations/[id]/join-code/route";
import RegisterPage from "@/app/register/page";
import LoginPage from "@/app/login/page";
import { call, db, loginAs, logout, makeOrg, makeTeam, uid } from "./helpers";
import { emptyDatabase, sessionCookie } from "./login-helpers";

let ipCounter = 0;
/** A fresh client address per request: the register limiter (10 an hour per address) stays out of the way. */
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function bootstrapBody(tag: string) {
  return { email: `boss-${tag}@first.run`, name: `Boss ${tag}`, password: "FirstRun-pass1", orgName: `First ${tag}` };
}

async function redirectOf(render: () => Promise<unknown> | unknown): Promise<string | null> {
  try {
    await render();
    return null;
  } catch (err) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec(err instanceof Error ? err.message : "");
    if (!m) throw err;
    return m[1] ?? "";
  }
}

describe("registration is closed once a company exists", () => {
  beforeEach(async () => {
    logout();
    await makeOrg(); // whatever ran before, at least one organization exists
  });

  it("creating a company is refused with 403 auth.registration_closed, and nothing is created", async () => {
    const tag = uid();
    const res = await call(registerRoute.POST, { body: bootstrapBody(tag), headers: { "x-forwarded-for": freshIp() } });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ error: "forbidden", message: "auth.registration_closed" });
    expect(await db.organization.count({ where: { name: `First ${tag}` } })).toBe(0);
    expect(await db.user.count({ where: { email: `boss-${tag}@first.run` } })).toBe(0);
    expect(sessionCookie()).toBeUndefined();
  });

  it("joining with an invitation code is gone (410), even with a real code", async () => {
    const { org } = await makeTeam();
    const email = `joiner-${uid()}@test.local`;
    const res = await call(registerRoute.POST, {
      body: { email, name: "Joiner", password: "Joiner-pass1", joinCode: org.joinCode },
      headers: { "x-forwarded-for": freshIp() },
    });
    expect(res.status).toBe(410);
    expect(res.json?.message).toBe("auth.registration_closed");
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect(sessionCookie()).toBeUndefined();
  });

  it("the register limiter still counts every attempt from one address", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await call(registerRoute.POST, { body: bootstrapBody(uid()), headers: { "x-forwarded-for": ip } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 403)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("the join-code endpoint is retired (410) and the stored codes are left alone", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const post = await call(joinCodeRoute.POST, { method: "POST", params: { id: org.id } });
    expect(post.status).toBe(410);
    expect(post.json?.message).toBe("auth.registration_closed");
    const get = await call(joinCodeRoute.GET, { params: { id: org.id } });
    expect(get.status).toBe(410);
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).joinCode).toBe(org.joinCode);
  });

  it("the /register page sends people to /login", async () => {
    expect(await redirectOf(() => RegisterPage())).toBe("/login");
  });

  it("the /login page does not offer the first-run set-up", async () => {
    const page = (await LoginPage()) as { props: { firstRun?: boolean } };
    expect(page.props.firstRun).toBe(false);
  });
});

/**
 * The very first run: no organization at all. These tests need a database with NOTHING in it, so
 * they run against a second, empty database, with every module re-imported to use it.
 */
describe("first run: the very first company (empty database)", () => {
  let empty: { client: PrismaClient; drop: () => Promise<void> } | undefined;
  let route: typeof import("@/app/api/auth/register/route");
  let me: typeof import("@/app/api/me/route");
  let page: typeof import("@/app/register/page");
  let login: typeof import("@/app/login/page");

  beforeAll(async () => {
    empty = await emptyDatabase();
    const client = empty.client;
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ db: client }));
    route = await import("@/app/api/auth/register/route");
    me = await import("@/app/api/me/route");
    page = await import("@/app/register/page");
    login = await import("@/app/login/page");
  }, 120_000);

  afterAll(async () => {
    vi.doUnmock("@/server/db");
    vi.resetModules();
    await empty?.drop();
  });

  it("the pages offer the set-up while nothing exists", async () => {
    expect(await redirectOf(() => page.default())).toBeNull();
    const loginPage = (await login.default()) as { props: { firstRun?: boolean } };
    expect(loginPage.props.firstRun).toBe(true);
  });

  it("two simultaneous first-run requests create ONE company; its owner is signed in and fully onboarded", async () => {
    logout();
    const client = empty!.client;
    const [a, b] = await Promise.all([
      call(route.POST, { body: bootstrapBody("a"), headers: { "x-forwarded-for": freshIp() } }),
      call(route.POST, { body: bootstrapBody("b"), headers: { "x-forwarded-for": freshIp() } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 403]);
    const loser = a.status === 403 ? a : b;
    expect(loser.json?.message).toBe("auth.registration_closed");

    expect(await client.organization.count()).toBe(1);
    expect(await client.user.count()).toBe(1);
    const owner = await client.user.findFirstOrThrow({ include: { memberships: true } });
    expect(owner.mustChangePassword).toBe(false);
    expect(owner.transparencyVersion).toBe(1);
    expect(owner.transparencyAcceptedAt).toBeInstanceOf(Date);
    expect(owner.memberships).toHaveLength(1);
    expect(owner.memberships[0]).toMatchObject({ role: "OWNER", status: "ACTIVE" });

    // the winner's browser is signed in, with nothing left to do
    const mine = await call(me.GET);
    expect(mine.status).toBe(200);
    expect(mine.json?.user).toMatchObject({ id: owner.id, mustChangePassword: false, transparencyPending: false });

    // from now on the door is closed
    const third = await call(route.POST, { body: bootstrapBody("c"), headers: { "x-forwarded-for": freshIp() } });
    expect(third.status).toBe(403);
    expect(await client.organization.count()).toBe(1);
    expect(await redirectOf(() => page.default())).toBe("/login");
  });
});
