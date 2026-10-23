import { describe, expect, it } from "vitest";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { call, db, loginAs, logout, makeOrg, makeUser, uid } from "./helpers";
import { giveSecondHome, makeSpaceWorld, notificationsOf, setStatus } from "./spaces-helpers";

/**
 * POST /api/workspaces — opening a space needs the capability `spaces.create` (every rank but GUEST
 * has it by default; the owner can switch it off per person), the creator becomes the space ADMIN, and
 * the people chosen at creation must be ACTIVE members of the same organization.
 */

const create = (body: unknown) => call(workspacesRoute.POST, { body });

const spaceNamed = (name: string) =>
  db.workspace.findFirst({ where: { name }, include: { members: { select: { userId: true, role: true } } } });

const roles = (rows: { userId: string; role: string }[]) =>
  Object.fromEntries([...rows].sort((a, b) => a.userId.localeCompare(b.userId)).map((r) => [r.userId, r.role]));

describe("POST /api/workspaces: who may open a space", () => {
  it("an anonymous caller is refused, and nothing is created", async () => {
    const name = `Anon ${uid()}`;
    logout();
    expect((await create({ name })).status).toBe(401);
    expect(await spaceNamed(name)).toBeNull();
  });

  it("an org GUEST holds no capability: refused, and nothing is created", async () => {
    const w = await makeSpaceWorld();
    const name = `Guest ${uid()}`;
    await loginAs(w.guest.id);
    const res = await create({ name });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("insufficient_role");
    expect(await spaceNamed(name)).toBeNull();
  });

  it.each(["owner", "admin", "lead", "member"] as const)(
    "a %s opens a space with no extra step (it comes with the rank); they become its ADMIN and it is theirs only",
    async (who) => {
      const w = await makeSpaceWorld();
      const name = `Made by ${who} ${uid()}`;
      await loginAs(w[who].id);
      const res = await create({ name, description: "what it is for" });
      expect(res.status).toBe(201);
      const made = res.json?.["workspace"] as { id: string; name: string; slug: string };
      expect(made.name).toBe(name);

      const ws = await spaceNamed(name);
      expect(ws?.id).toBe(made.id);
      expect(ws?.organizationId).toBe(w.org.id);
      expect(ws?.description).toBe("what it is for");
      // only the creator is in it, as its ADMIN: nobody else gets a space by rank (the owner sees all, silently)
      expect(ws?.members).toEqual([{ userId: w[who].id, role: "ADMIN" }]);
    },
  );

  it("an old client that still sends organizationId for its own organization keeps working", async () => {
    const w = await makeSpaceWorld();
    const name = `Legacy ${uid()}`;
    await loginAs(w.member.id);
    expect((await create({ organizationId: w.org.id, name })).status).toBe(201);
    expect((await spaceNamed(name))?.organizationId).toBe(w.org.id);
  });
});

describe("POST /api/workspaces: the capability can be switched off per person", () => {
  const revoke = (orgId: string, userId: string) =>
    db.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      data: { revokedCapabilities: ["spaces.create"] },
    });

  it.each(["admin", "lead", "member"] as const)("a %s whose spaces.create is switched off is refused, and nothing is created", async (who) => {
    const w = await makeSpaceWorld();
    await revoke(w.org.id, w[who].id);
    const name = `Revoked ${uid()}`;
    await loginAs(w[who].id);
    const res = await create({ name });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("insufficient_role");
    expect(await spaceNamed(name)).toBeNull();
  });

  it("the owner holds every capability whatever is stored for them", async () => {
    const w = await makeSpaceWorld();
    await revoke(w.org.id, w.owner.id);
    await loginAs(w.owner.id);
    expect((await create({ name: `Owner ${uid()}` })).status).toBe(201);
  });

  it("a guest can never hold it, even if someone stored it for them", async () => {
    const w = await makeSpaceWorld();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.guest.id } },
      data: { capabilities: ["spaces.create"] },
    });
    const name = `Stored for a guest ${uid()}`;
    await loginAs(w.guest.id);
    expect((await create({ name })).status).toBe(403);
    expect(await spaceNamed(name)).toBeNull();
  });

  it("someone who has not finished their onboarding (temporary password) cannot open a space yet", async () => {
    const w = await makeSpaceWorld();
    await db.user.update({ where: { id: w.member.id }, data: { mustChangePassword: true } });
    const name = `Too early ${uid()}`;
    await loginAs(w.member.id);
    const res = await create({ name });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("auth.onboarding_required");
    expect(await spaceNamed(name)).toBeNull();
  });
});

describe("POST /api/workspaces: choosing the people at creation", () => {
  it("adds them: a normal member as MEMBER, an org GUEST as a GUEST, a repeated id and the creator's own id once; each is told once, the creator never", async () => {
    const w = await makeSpaceWorld();
    const colleague = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Colleague" });
    const name = `With people ${uid()}`;
    await loginAs(w.member.id);
    const res = await create({
      name,
      memberIds: [colleague.id, w.guest.id, colleague.id, w.member.id, w.admin.id, w.lead.id],
    });
    expect(res.status).toBe(201);

    const ws = await spaceNamed(name);
    expect(roles(ws!.members)).toEqual(
      roles([
        { userId: w.member.id, role: "ADMIN" }, // the creator stays its ADMIN even though they listed themselves
        { userId: colleague.id, role: "MEMBER" },
        { userId: w.guest.id, role: "GUEST" }, // a guest is a guest whatever was asked
        { userId: w.admin.id, role: "MEMBER" }, // an org ADMIN is just a person in the space, not its admin
        { userId: w.lead.id, role: "MEMBER" },
      ]),
    );
    expect(ws!.members).toHaveLength(5); // no duplicate row

    for (const person of [colleague, w.guest, w.admin, w.lead]) {
      expect(await notificationsOf(person.id), person.name).toEqual([{ type: "ws_member_added", title: name }]);
    }
    expect(await notificationsOf(w.member.id)).toEqual([]);
  });

  it("the OWNER can open a space for the team without being the only person in it: the owner is its ADMIN row, the rest MEMBER", async () => {
    const w = await makeSpaceWorld();
    const name = `Owner's team ${uid()}`;
    await loginAs(w.owner.id);
    const res = await create({ name, memberIds: [w.member.id, w.lead.id] });
    expect(res.status).toBe(201);
    expect(roles((await spaceNamed(name))!.members)).toEqual(
      roles([
        { userId: w.owner.id, role: "ADMIN" },
        { userId: w.member.id, role: "MEMBER" },
        { userId: w.lead.id, role: "MEMBER" },
      ]),
    );
  });

  it.each(["another organization's member", "a suspended member", "an offboarded member", "an id that belongs to nobody"] as const)(
    "refuses %s - and creates nothing, adds nobody, tells nobody",
    async (kind) => {
      const w = await makeSpaceWorld();
      const colleague = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Valid colleague" });
      let bad: string;
      if (kind === "another organization's member") {
        const otherOrg = await makeOrg();
        bad = (await makeUser({ orgId: otherOrg.id, role: "MEMBER" })).id;
      } else if (kind === "a suspended member") {
        const p = await makeUser({ orgId: w.org.id, role: "MEMBER" });
        await setStatus(w.org.id, p.id, "SUSPENDED");
        bad = p.id;
      } else if (kind === "an offboarded member") {
        const p = await makeUser({ orgId: w.org.id, role: "MEMBER" });
        await setStatus(w.org.id, p.id, "OFFBOARDED");
        bad = p.id;
      } else {
        bad = `no-such-user-${uid()}`;
      }
      const name = `Refused ${uid()}`;
      await loginAs(w.member.id);
      const res = await create({ name, memberIds: [colleague.id, bad] });
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("spaces.member_not_in_org");
      expect(await spaceNamed(name)).toBeNull();
      expect(await notificationsOf(colleague.id)).toEqual([]);
    },
  );

  it("a person who left the organization altogether (no membership row at all) is refused too", async () => {
    const w = await makeSpaceWorld();
    const gone = await makeUser({ orgId: w.org.id, role: "MEMBER" });
    await db.organizationMember.deleteMany({ where: { organizationId: w.org.id, userId: gone.id } });
    const name = `Gone ${uid()}`;
    await loginAs(w.member.id);
    const res = await create({ name, memberIds: [gone.id] });
    expect(res.status).toBe(403);
    expect(await spaceNamed(name)).toBeNull();
  });
});

describe("POST /api/workspaces: which organization", () => {
  it("someone in two organizations opens the space in the one they name, using their rights THERE", async () => {
    const w = await makeSpaceWorld();
    const second = await giveSecondHome(w.member.id, "OWNER"); // a plain member of the first org, the owner of the second
    await loginAs(w.member.id);

    const inSecond = `In the second ${uid()}`;
    expect((await create({ organizationId: second.id, name: inSecond })).status).toBe(201);
    expect((await spaceNamed(inSecond))?.organizationId).toBe(second.id);

    const inFirst = `In the first ${uid()}`;
    expect((await create({ organizationId: w.org.id, name: inFirst })).status).toBe(201);
    expect((await spaceNamed(inFirst))?.organizationId).toBe(w.org.id);

    // with no organization named, it is the one they work in (their oldest ACTIVE membership)
    const unnamed = `Unnamed ${uid()}`;
    expect((await create({ name: unnamed })).status).toBe(201);
    expect((await spaceNamed(unnamed))?.organizationId).toBe(w.org.id);
  });

  it("an organization the caller does not belong to is refused, and so is one where they hold no right", async () => {
    const w = await makeSpaceWorld();
    const stranger = await makeOrg();
    const name = `Foreign ${uid()}`;
    await loginAs(w.member.id);
    const res = await create({ organizationId: stranger.id, name });
    expect(res.status).toBe(403);
    expect(await spaceNamed(name)).toBeNull();

    // a guest of the second org holds nothing there, even though they are a MEMBER of the first
    const second = await giveSecondHome(w.member.id, "MEMBER");
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: second.id, userId: w.member.id } },
      data: { role: "GUEST" },
    });
    const denied = await create({ organizationId: second.id, name });
    expect(denied.status).toBe(403);
    expect(denied.json?.["message"]).toBe("insufficient_role");
    expect(await spaceNamed(name)).toBeNull();
  });

  it("people chosen for a space must belong to THAT organization, not just to any organization of the caller", async () => {
    const w = await makeSpaceWorld();
    const second = await giveSecondHome(w.member.id, "OWNER");
    const colleagueOfFirst = await makeUser({ orgId: w.org.id, role: "MEMBER" });
    const name = `Mixed up ${uid()}`;
    await loginAs(w.member.id);
    const res = await create({ organizationId: second.id, name, memberIds: [colleagueOfFirst.id] });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("spaces.member_not_in_org");
    expect(await spaceNamed(name)).toBeNull();
  });
});

describe("POST /api/workspaces: input and record", () => {
  it("validates the body: a name is required (1-120 characters), the description is bounded, the list of people is bounded", async () => {
    const w = await makeSpaceWorld();
    await loginAs(w.member.id);
    expect((await create({ name: `Valid ${uid()}`, description: "fine", memberIds: [w.lead.id] })).status).toBe(201); // the control
    expect((await create({})).status).toBe(422);
    expect((await create({ name: "   " })).status).toBe(422);
    expect((await create({ name: "x".repeat(121) })).status).toBe(422);
    expect((await create({ name: `ok ${uid()}`, description: "d".repeat(2001) })).status).toBe(422);
    expect((await create({ name: `ok ${uid()}`, memberIds: "not-a-list" })).status).toBe(422);
    expect((await create({ name: `ok ${uid()}`, memberIds: Array.from({ length: 201 }, (_, i) => `u${i}`) })).status).toBe(422);
  });

  it("writes an audit entry for the creation, naming who did it", async () => {
    const w = await makeSpaceWorld();
    const name = `Audited ${uid()}`;
    await loginAs(w.lead.id);
    const res = await create({ name });
    const id = (res.json?.["workspace"] as { id: string }).id;
    const entry = await db.auditLog.findFirst({ where: { action: "workspace.created", target: id } });
    expect(entry).toMatchObject({ actorId: w.lead.id, orgId: w.org.id });
  });

  it("two spaces with the same name can exist side by side (the slug is unique)", async () => {
    const w = await makeSpaceWorld();
    const name = `Twin ${uid()}`;
    await loginAs(w.member.id);
    expect((await create({ name })).status).toBe(201);
    expect((await create({ name })).status).toBe(201);
    expect(await db.workspace.count({ where: { name } })).toBe(2);
  });
});
