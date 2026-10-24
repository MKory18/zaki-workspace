/**
 * Phase 3 (chat): the HQ hooks in the services (the minimal wiring of `@/server/chat/hq`).
 *
 *  - creating the company also creates its HQ space and its five topics — exactly once (the hook is
 *    idempotent, and on a database the data move already migrated it is a no-op);
 *  - creating an account puts the person in the HQ space; a GUEST is never put in;
 *  - reactivating a suspended person puts them back in HQ (a guest never);
 *  - offboarding takes the person out of every topic conversation (their DMs stay, so the other
 *    side keeps the history) and writes its audit row;
 *  - removing a member from a space writes an audit row carrying the space (`AuditLog.workspaceId`),
 *    and the moderators' mute row already does.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { call, db, loginAs, logout, makeOrg, makeTeam, uid } from "./helpers";
import { accountsApi, username } from "./accounts-helpers";
import { makeSpaceWorld } from "./spaces-helpers";
import { changeWorkspaceMembers } from "@/server/services/workspaces";
import { muteInSpace } from "@/server/chat/moderation";
import { addPersonToHq, ensureHqSpace, HQ_TOPICS, hqSpaceIdOf, hqTopicIdOf } from "@/server/chat/hq";
import { emptyDatabase } from "./login-helpers";

const userIdOf = (res: { json: Record<string, unknown> | null }) => (res.json as { userId: string }).userId;

afterAll(async () => {
  await db.$disconnect();
});

describe("creating an account and the HQ space", () => {
  it("a new MEMBER is put in the HQ space; a new GUEST is not", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);

    const member = await accountsApi.create(org.id, { name: "موظف جديد", username: username(), role: "MEMBER" });
    expect(member.status).toBe(201);
    const spaceId = hqSpaceIdOf(org.id);
    expect(await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: spaceId, userId: userIdOf(member) } } })).toMatchObject({
      role: "MEMBER",
    });

    const guest = await accountsApi.create(org.id, { name: "شريك خارجي", username: username(), role: "GUEST" });
    expect(guest.status).toBe(201);
    expect(await db.workspaceMember.count({ where: { workspaceId: spaceId, userId: userIdOf(guest) } })).toBe(0);
  });

  it("reactivating a member puts them back in HQ; a reactivated guest does not get a row", async () => {
    const { org, owner, member, guest } = await makeTeam();
    await loginAs(owner.id);
    expect(await db.workspaceMember.count({ where: { workspaceId: hqSpaceIdOf(org.id) } })).toBe(0); // nothing exists yet

    await accountsApi.status(org.id, member.id, { action: "suspend" });
    const back = await accountsApi.status(org.id, member.id, { action: "reactivate" });
    expect(back.status).toBe(200);
    expect(
      await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: hqSpaceIdOf(org.id), userId: member.id } } }),
    ).toMatchObject({ role: "MEMBER" });

    await accountsApi.status(org.id, guest.id, { action: "suspend" });
    expect((await accountsApi.status(org.id, guest.id, { action: "reactivate" })).status).toBe(200);
    expect(await db.workspaceMember.count({ where: { workspaceId: hqSpaceIdOf(org.id), userId: guest.id } })).toBe(0);
  });

  it("keeps HQ membership aligned when an active account changes role", async () => {
    const { org, owner, member, guest } = await makeTeam();
    const spaceId = hqSpaceIdOf(org.id);
    const otherSpace = await db.workspace.create({
      data: { organizationId: org.id, name: "مشروع", slug: `ws-${uid()}`, members: { create: { userId: member.id } } },
    });
    await loginAs(owner.id);

    expect((await accountsApi.update(org.id, member.id, { role: "GUEST" })).status).toBe(200);
    expect(await db.workspaceMember.count({ where: { workspaceId: spaceId, userId: member.id } })).toBe(0);
    expect(await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: otherSpace.id, userId: member.id } } })).toMatchObject({ role: "GUEST" });

    expect((await accountsApi.update(org.id, guest.id, { role: "MEMBER" })).status).toBe(200);
    expect(await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: spaceId, userId: guest.id } } })).toMatchObject({ role: "MEMBER" });
  });

  it("does not add a person to HQ unless their persisted org membership is ACTIVE", async () => {
    const { org, member } = await makeTeam();
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: org.id, userId: member.id } }, data: { status: "SUSPENDED" } });

    await addPersonToHq(org.id, member.id, "MEMBER");

    expect(await db.workspaceMember.count({ where: { workspaceId: hqSpaceIdOf(org.id), userId: member.id } })).toBe(0);
  });

  it("offboarding removes the person's topic rows, keeps their DM row, and is audited", async () => {
    const { org, owner, member } = await makeTeam();
    const space = await db.workspace.create({
      data: { organizationId: org.id, name: "الشغل", slug: `ws-${uid()}`, members: { create: { userId: member.id } } },
    });
    const topic = await db.conversation.create({ data: { orgId: org.id, kind: "TOPIC", spaceId: space.id, title: "عام" } });
    const dm = await db.conversation.create({
      data: { orgId: org.id, kind: "DM", members: { create: [{ userId: member.id }, { userId: owner.id }] } },
    });
    await db.conversationMember.create({ data: { conversationId: topic.id, userId: member.id } });

    await loginAs(owner.id);
    expect((await accountsApi.status(org.id, member.id, { action: "offboard" })).status).toBe(200);

    expect(await db.conversationMember.count({ where: { conversationId: topic.id, userId: member.id } })).toBe(0);
    expect(await db.conversationMember.count({ where: { conversationId: dm.id, userId: member.id } })).toBe(1);
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "org.member_offboarded_chat", target: member.id } })).toMatchObject({
      orgId: org.id,
    });
    // the offboarding itself is still audited exactly as before
    expect(await db.auditLog.count({ where: { action: "org.member_offboarded", target: member.id } })).toBe(1);
  });
});

describe("the HQ space itself", () => {
  it("creating it twice leaves one space and the five topics, with the data move's exact ids", async () => {
    const org = await makeOrg();
    await ensureHqSpace(org.id, "الشركة");
    await ensureHqSpace(org.id, "الشركة");

    expect(await db.workspace.count({ where: { organizationId: org.id, systemKey: "hq" } })).toBe(1);
    expect(await db.conversation.count({ where: { orgId: org.id, systemKey: { not: null } } })).toBe(HQ_TOPICS.length);
    const topics = await db.conversation.findMany({ where: { spaceId: hqSpaceIdOf(org.id) }, orderBy: { position: "asc" } });
    expect(topics.map((t) => [t.systemKey, t.title, t.id])).toEqual(
      HQ_TOPICS.map((t) => [t.key, t.title, hqTopicIdOf(org.id, t.key)]),
    );
  });
});

describe("space removal and mute audit rows", () => {
  it("removing a member from a space writes an audit row with the space on it; a demote writes none", async () => {
    const w = await makeSpaceWorld({ member: "MEMBER", lead: "ADMIN" });
    await changeWorkspaceMembers({ userId: w.lead.id, orgRole: "ADMIN" }, w.ws.id, { remove: [w.member.id] });
    expect(
      await db.auditLog.findFirstOrThrow({ where: { action: "workspace.member_removed", workspaceId: w.ws.id } }),
    ).toMatchObject({ orgId: w.org.id, target: w.member.id });

    await changeWorkspaceMembers({ userId: w.lead.id, orgRole: "OWNER" }, w.ws.id, { demote: [w.lead.id] });
    expect(await db.auditLog.count({ where: { action: "workspace.member_removed", workspaceId: w.ws.id } })).toBe(1);
  });

  it("muting a person in a space writes its audit row with the space on it", async () => {
    const w = await makeSpaceWorld({ member: "MEMBER", lead: "ADMIN" });
    const res = await muteInSpace({ orgId: w.org.id, orgRole: "LEAD", userId: w.lead.id }, w.ws.id, {
      userId: w.member.id,
      until: "1h",
    });
    expect(res.mutedUntil).not.toBeNull();
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "chat.mute", workspaceId: w.ws.id } })).toMatchObject({
      orgId: w.org.id,
      target: w.member.id,
    });
  });
});

describe("the very first company: its HQ space comes with it (empty database)", () => {
  let empty: { client: PrismaClient; drop: () => Promise<void> } | undefined;
  let route: typeof import("@/app/api/auth/register/route");
  let confirmRoute: typeof import("@/app/api/auth/register/confirm/route");
  let mail: typeof import("@/server/mail");

  beforeAll(async () => {
    empty = await emptyDatabase();
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ db: empty!.client }));
    route = await import("@/app/api/auth/register/route");
    confirmRoute = await import("@/app/api/auth/register/confirm/route");
    mail = await import("@/server/mail");
  }, 120_000);

  afterAll(async () => {
    vi.doUnmock("@/server/db");
    vi.resetModules();
    await empty?.drop();
  });

  it("creating the company creates its HQ space and its five topics exactly once", async () => {
    logout();
    const tag = uid();
    const email = `boss-${tag}@first.run`;
    const ip = `203.0.113.${(tag.charCodeAt(0) % 80) + 100}`;
    const asked = await call(route.POST, {
      body: { email, name: `Boss ${tag}`, password: "FirstRun-pass1", orgName: `First ${tag}` },
      headers: { "x-forwarded-for": ip },
    });
    expect(asked.status).toBe(202);
    // the company is created when the mailed link is confirmed (services/registration.ts)
    const link = [...mail.mailOutbox()].reverse().find((m) => m.to === email)?.text ?? "";
    const token = /\/register\/confirm\?token=([A-Za-z0-9_-]+)/.exec(link)?.[1] ?? "";
    const res = await call(confirmRoute.POST, { body: { token }, headers: { "x-forwarded-for": ip } });
    expect(res.status).toBe(201);

    const client = empty!.client;
    const space = await client.workspace.findFirstOrThrow({ where: { systemKey: "hq" } });
    expect(space).toMatchObject({ kind: "HQ", slug: "hq", name: "الشركة" });
    expect(space.id).toBe(hqSpaceIdOf(space.organizationId));
    const topics = await client.conversation.findMany({ where: { spaceId: space.id }, orderBy: { position: "asc" } });
    expect(topics.map((t) => t.systemKey)).toEqual(HQ_TOPICS.map((t) => t.key));
    expect(topics.map((t) => t.id)).toEqual(HQ_TOPICS.map((t) => hqTopicIdOf(space.organizationId, t.key)));
    // the owner is in no row anywhere (he reads silently), and the company has exactly one space
    expect(await client.workspaceMember.count({ where: { workspaceId: space.id } })).toBe(0);
    expect(await client.workspace.count({ where: { organizationId: space.organizationId } })).toBe(1);
  });
});
