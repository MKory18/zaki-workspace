import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import * as registerRoute from "@/app/api/auth/register/route";
import * as confirmRoute from "@/app/api/auth/register/confirm/route";
import * as joinCodeRoute from "@/app/api/organizations/[id]/join-code/route";
import { mailOutbox, type MailMessage } from "@/server/mail";
import { purgeExpiredRegistrations } from "@/server/services/registration";
import { call, db, loginAs, logout, makeOrg, makeTeam, makeUser, uid } from "./helpers";
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

/** The last message the server kept for this address (tests keep mail instead of sending it). */
function lastMailTo(email: string, outbox: MailMessage[] = mailOutbox()): MailMessage | undefined {
  return [...outbox].reverse().find((m) => m.to === email);
}

function tokenOf(mail: MailMessage | undefined): string {
  const m = /\/register\/confirm\?token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "");
  if (!m) throw new Error("no confirmation link in the mail");
  return m[1]!;
}

const ask = (body: unknown, ip = freshIp()) => call(registerRoute.POST, { body, headers: { "x-forwarded-for": ip } });
const confirm = (token: string, ip = freshIp()) => call(confirmRoute.POST, { body: { token }, headers: { "x-forwarded-for": ip } });

const savedEnv = { ...process.env };
beforeEach(() => {
  logout();
  // the server-wide cap has its own test; keep it out of the way of the others
  process.env["REGISTER_GLOBAL_PER_HOUR"] = "100000";
  process.env["REGISTER_GLOBAL_PER_DAY"] = "100000";
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const k of ["REGISTER_GLOBAL_PER_HOUR", "REGISTER_GLOBAL_PER_DAY", "SMTP_HOST", "MAIL_FROM"]) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("opening a company: anyone may ask, the company exists once the e-mail is confirmed", () => {
  beforeEach(async () => {
    await makeOrg(); // other companies already exist
  });

  it("asking answers 202, keeps one link for the address, and creates nothing that can sign in", async () => {
    const tag = uid();
    const body = bootstrapBody(tag);
    const res = await ask(body);
    expect(res.status).toBe(202);
    expect(res.json).toEqual({ ok: true, next: "/register/check-email" });
    expect(sessionCookie()).toBeUndefined();
    expect(await db.organization.count({ where: { name: body.orgName } })).toBe(0);
    expect(await db.user.count({ where: { email: body.email } })).toBe(0);
    expect(await db.pendingRegistration.count({ where: { email: body.email } })).toBe(1);
    const row = await db.pendingRegistration.findFirstOrThrow({ where: { email: body.email } });
    expect(row.passwordHash).not.toContain(body.password);
    // only the token's hash is stored: the mailed token itself is nowhere in the row
    const token = tokenOf(lastMailTo(body.email));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("confirming creates the company with its OWNER, signs them in, and works only once", async () => {
    const body = bootstrapBody(uid());
    await ask(body);
    const token = tokenOf(lastMailTo(body.email));

    const first = await confirm(token);
    expect(first.status).toBe(201);
    expect(first.json).toEqual({ ok: true, next: "/" });
    expect(sessionCookie()).toBeDefined();
    const owner = await db.user.findUniqueOrThrow({ where: { email: body.email }, include: { memberships: true } });
    expect(owner.mustChangePassword).toBe(false);
    expect(owner.memberships).toHaveLength(1);
    expect(owner.memberships[0]).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    expect(await db.organization.count({ where: { name: body.orgName } })).toBe(1);
    expect(await db.pendingRegistration.count({ where: { email: body.email } })).toBe(0);

    logout();
    const again = await confirm(token);
    expect(again.status).toBe(404);
    expect(again.json?.["message"]).toBe("auth.registration_link_invalid");
    expect(sessionCookie()).toBeUndefined();
    expect(await db.organization.count({ where: { name: body.orgName } })).toBe(1);
  });

  it("an address that already has an account gets the very same answer, and its owner a 'somebody tried' mail with no link", async () => {
    const existing = await makeUser({ email: `known-${uid()}@test.local` });
    const fresh = bootstrapBody(uid());
    const known = { ...bootstrapBody(uid()), email: existing.email };

    const a = await ask(fresh);
    const b = await ask(known);
    expect(b.status).toBe(a.status);
    expect(b.json).toEqual(a.json);
    expect(b.text).not.toContain("taken");

    const mail = lastMailTo(existing.email);
    expect(mail?.text).toContain("/login");
    expect(mail?.text).not.toContain("/register/confirm");
    expect(await db.user.count({ where: { email: existing.email } })).toBe(1);
    expect(await db.organization.count({ where: { name: known.orgName } })).toBe(0);
  });

  it("the mail never carries the asker's own words (no free-text relay to any address)", async () => {
    const body = { ...bootstrapBody(uid()), name: "WIN A PRIZE", orgName: "CLICK http://spam.example" };
    await ask(body);
    const mail = lastMailTo(body.email);
    expect(mail?.text).not.toContain("WIN A PRIZE");
    expect(mail?.text).not.toContain("spam.example");
    expect(mail?.subject).not.toContain("spam.example");
  });

  it("a newer request replaces the older link", async () => {
    const body = bootstrapBody(uid());
    await ask(body);
    const old = tokenOf(lastMailTo(body.email));
    await ask(body);
    const current = tokenOf(lastMailTo(body.email));
    expect(current).not.toBe(old);
    expect((await confirm(old)).status).toBe(404);
    expect((await confirm(current)).status).toBe(201);
  });

  it("an expired link is refused, and the hourly purge removes it", async () => {
    const body = bootstrapBody(uid());
    await ask(body);
    const token = tokenOf(lastMailTo(body.email));
    await db.pendingRegistration.updateMany({ where: { email: body.email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await confirm(token);
    expect(res.status).toBe(404);
    expect(res.json?.["message"]).toBe("auth.registration_link_invalid");
    expect(await purgeExpiredRegistrations()).toBeGreaterThanOrEqual(1);
    expect(await db.pendingRegistration.count({ where: { email: body.email } })).toBe(0);
    expect(await db.user.count({ where: { email: body.email } })).toBe(0);
  });

  it("an unknown or malformed token is refused without creating anything", async () => {
    expect((await confirm("x".repeat(43))).status).toBe(404);
    expect((await call(confirmRoute.POST, { body: { token: "" }, headers: { "x-forwarded-for": freshIp() } })).status).toBe(422);
  });

  it("the server-wide cap refuses more requests per hour, from any address", async () => {
    const since = new Date(Date.now() - 3600_000);
    const already = await db.pendingRegistration.count({ where: { createdAt: { gte: since } } });
    process.env["REGISTER_GLOBAL_PER_HOUR"] = String(already + 1);
    expect((await ask(bootstrapBody(uid()))).status).toBe(202);
    const refused = await ask(bootstrapBody(uid()));
    expect(refused.status).toBe(429);
    expect(refused.json?.["message"]).toBe("auth.registration_busy");
  });

  it("a production server without SMTP answers 503 instead of promising a mail that never comes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env["SMTP_HOST"];
    delete process.env["MAIL_FROM"];
    const body = bootstrapBody(uid());
    const res = await ask(body);
    expect(res.status).toBe(503);
    expect(res.json?.["message"]).toBe("auth.registration_unavailable");
    expect(await db.pendingRegistration.count({ where: { email: body.email } })).toBe(0);
  });

  it("joining with an invitation code is gone (410), even with a real code", async () => {
    const { org } = await makeTeam();
    const email = `joiner-${uid()}@test.local`;
    const res = await ask({ email, name: "Joiner", password: "Joiner-pass1", joinCode: org.joinCode });
    expect(res.status).toBe(410);
    expect(res.json?.["message"]).toBe("auth.registration_closed");
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect(await db.pendingRegistration.count({ where: { email } })).toBe(0);
    expect(sessionCookie()).toBeUndefined();
  });

  it("the register limiter still counts every attempt from one address", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await ask(bootstrapBody(uid()), ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("the join-code endpoint is retired (410) and the stored codes are left alone", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const post = await call(joinCodeRoute.POST, { method: "POST", params: { id: org.id } });
    expect(post.status).toBe(410);
    expect(post.json?.["message"]).toBe("auth.registration_closed");
    const get = await call(joinCodeRoute.GET, { params: { id: org.id } });
    expect(get.status).toBe(410);
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).joinCode).toBe(org.joinCode);
  });
});

/**
 * The very first run: no organization at all. These tests need a database with NOTHING in it, so
 * they run against a second, empty database, with every module re-imported to use it.
 */
describe("first run: the first companies on an empty database", () => {
  let empty: { client: PrismaClient; drop: () => Promise<void> } | undefined;
  let route: typeof import("@/app/api/auth/register/route");
  let confirmFirst: typeof import("@/app/api/auth/register/confirm/route");
  let mail: typeof import("@/server/mail");
  let me: typeof import("@/app/api/me/route");

  beforeAll(async () => {
    empty = await emptyDatabase();
    const client = empty.client;
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ db: client }));
    route = await import("@/app/api/auth/register/route");
    confirmFirst = await import("@/app/api/auth/register/confirm/route");
    mail = await import("@/server/mail");
    me = await import("@/app/api/me/route");
  }, 120_000);

  afterAll(async () => {
    vi.doUnmock("@/server/db");
    vi.resetModules();
    await empty?.drop();
  });

  it("two people asking and confirming at the same time each get their own company", async () => {
    const client = empty!.client;
    const [a, b] = [bootstrapBody("a"), bootstrapBody("b")];
    const asked = await Promise.all([a, b].map((body) => call(route.POST, { body, headers: { "x-forwarded-for": freshIp() } })));
    expect(asked.map((r) => r.status)).toEqual([202, 202]);

    const tokens = [a, b].map((body) => tokenOf(lastMailTo(body.email, mail.mailOutbox())));
    const confirmed = await Promise.all(
      tokens.map((token) => call(confirmFirst.POST, { body: { token }, headers: { "x-forwarded-for": freshIp() } })),
    );
    expect(confirmed.map((r) => r.status)).toEqual([201, 201]);

    expect(await client.organization.count()).toBe(2);
    expect(await client.user.count()).toBe(2);
    const owners = await client.user.findMany({ include: { memberships: true } });
    for (const owner of owners) {
      expect(owner.mustChangePassword).toBe(false);
      expect(owner.transparencyVersion).toBe(1);
      expect(owner.transparencyAcceptedAt).toBeInstanceOf(Date);
      expect(owner.memberships).toHaveLength(1);
      expect(owner.memberships[0]).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    }

    // the last one to confirm is signed in
    expect((await call(me.GET)).status).toBe(200);
  });
});
