import { describe, expect, it } from "vitest";
import * as voteRoute from "@/app/api/ideas/[id]/vote/route";
import { createGroup, manageGroup, openDm } from "@/server/chat/dm";
import { chatDirectory } from "@/server/chat/directory";
import { getProfileForViewer, memberDirectory } from "@/server/services/users";
import { listWorkspacePeople } from "@/server/services/views";
import { loadAnalytics } from "@/server/services/analytics";
import { handleInbound } from "@/server/services/n8n";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { connectN8nDirect, N8N_SECRET } from "./integrations-helpers";
import { ctxOf, offboard, suspend } from "./active-helpers";

/**
 * "Nobody who was suspended or removed still counts" - the lists and look-ups of people.
 * A plain colleague (active), a SUSPENDED one and an OFFBOARDED one share the organization.
 */
async function world() {
  const team = await makeTeam();
  const active = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Active colleague" });
  const suspended = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Suspended colleague" });
  const gone = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Offboarded colleague" });
  await suspend(team.org.id, suspended.id);
  await offboard(team.org.id, gone.id);
  return { ...team, active, suspended, gone };
}

// The live chat doors (src/server/chat/dm.ts and directory.ts); these cases were written against the
// retired services/chat.ts and moved here with the same claims and the live answers: a group asked to
// take in somebody who is out is refused whole (nothing is created), and extended without them.
describe("chat: a conversation partner must be an active member of the same organization", () => {
  it("a DM with a suspended or an offboarded person is refused and creates nothing", async () => {
    const w = await world();
    for (const person of [w.suspended, w.gone]) {
      await expect(openDm(ctxOf(w.org.id, w.member.id), person.id)).rejects.toMatchObject({
        name: "NotFoundError",
        message: "chat.e.not_found",
      });
    }
    expect(await db.conversation.count({ where: { orgId: w.org.id, kind: "DM" } })).toBe(0);
    // an active colleague is still fine
    expect((await openDm(ctxOf(w.org.id, w.member.id), w.active.id)).id).toBeTruthy();
  });

  it("a group never takes them in: refused when it is created with them, and an extension leaves them out", async () => {
    const w = await world();
    const ctx = ctxOf(w.org.id, w.member.id);
    await expect(createGroup(ctx, { title: "Shop floor", memberIds: [w.active.id, w.suspended.id, w.gone.id] })).rejects.toMatchObject({
      name: "NotFoundError",
    });
    expect(await db.conversation.count({ where: { orgId: w.org.id, kind: "GROUP" } })).toBe(0);

    const { id } = await createGroup(ctx, { title: "Shop floor", memberIds: [w.active.id] });
    const another = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Another colleague" });
    await manageGroup(ctx, id, { addMemberIds: [another.id, w.suspended.id, w.gone.id] });
    const extended = await db.conversationMember.findMany({ where: { conversationId: id } });
    expect(extended.map((m) => m.userId).sort()).toEqual([w.member.id, w.active.id, another.id].sort());
  });

  it("a group of nobody but them is not created", async () => {
    const w = await world();
    await expect(createGroup(ctxOf(w.org.id, w.member.id), { title: "Ghost town", memberIds: [w.suspended.id, w.gone.id] })).rejects.toMatchObject({
      name: "NotFoundError",
    });
    expect(await db.conversation.count({ where: { orgId: w.org.id, kind: "GROUP" } })).toBe(0);
  });

  it("the recipients picker does not offer them", async () => {
    const w = await world();
    const names = (await chatDirectory(w.org.id)).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Owner", "Admin", "Member", "Active colleague"]));
    expect(names).not.toContain("Suspended colleague");
    expect(names).not.toContain("Offboarded colleague");
    expect(names).not.toContain("Guest");
  });
});

describe("the staff directory and profiles count active people only", () => {
  it("lists neither the suspended nor the offboarded to a member or an admin", async () => {
    const w = await world();
    for (const viewer of [w.member, w.admin]) {
      const org = (await memberDirectory(viewer.id))[0]!;
      const names = org.members.map((m) => m.name);
      expect(names).toEqual(expect.arrayContaining(["Owner", "Admin", "Member", "Active colleague", "Guest"]));
      expect(names).not.toContain("Suspended colleague");
      expect(names).not.toContain("Offboarded colleague");
    }
  });

  it("puts a team lead between the admins and the members (the new rank has a place)", async () => {
    const w = await world();
    await makeUser({ orgId: w.org.id, role: "LEAD", name: "Team lead" });
    const org = (await memberDirectory(w.member.id))[0]!;
    expect(org.members.map((m) => m.role)).toEqual(["OWNER", "ADMIN", "LEAD", "MEMBER", "MEMBER", "GUEST"]);
  });

  it("does not show a suspended workspace mate to a guest", async () => {
    const w = await world();
    await makeWorkspace(w.org.id, [
      { userId: w.guest.id, role: "GUEST" },
      { userId: w.active.id },
      { userId: w.suspended.id },
      { userId: w.gone.id },
    ]);
    const org = (await memberDirectory(w.guest.id))[0]!;
    expect(org.members.map((m) => m.name).sort()).toEqual(["Active colleague", "Guest"]);
  });

  it("gives a suspended viewer no directory at all", async () => {
    const w = await world();
    expect(await memberDirectory(w.suspended.id)).toEqual([]);
  });

  it("a profile of somebody who is out is 'not found'; a viewer who is out sees no profiles", async () => {
    const w = await world();
    for (const person of [w.suspended, w.gone]) {
      await expect(getProfileForViewer(w.member.id, person.id)).rejects.toMatchObject({ name: "NotFoundError", message: "user.not_found" });
    }
    await expect(getProfileForViewer(w.suspended.id, w.member.id)).rejects.toMatchObject({ name: "ForbiddenError", message: "not_org_member" });
    // a colleague who is active is still visible
    const view = await getProfileForViewer(w.member.id, w.active.id);
    expect(view.kind).toBe("full");
  });

  it("a guest gets 'not found' for a suspended workspace mate", async () => {
    const w = await world();
    await makeWorkspace(w.org.id, [{ userId: w.guest.id, role: "GUEST" }, { userId: w.suspended.id }]);
    await expect(getProfileForViewer(w.guest.id, w.suspended.id)).rejects.toMatchObject({ name: "NotFoundError" });
  });
});

describe("the List page's assignee filter offers active people only", () => {
  it("for an organization member and for a guest alike", async () => {
    const w = await world();
    const ws = await makeWorkspace(w.org.id, [
      { userId: w.member.id },
      { userId: w.guest.id, role: "GUEST" },
      { userId: w.active.id },
      { userId: w.suspended.id },
      { userId: w.gone.id },
    ]);
    const names = (people: { name: string }[]) => people.map((p) => p.name).sort();

    const forMember = await listWorkspacePeople({ orgId: w.org.id, workspaceId: ws.id, orgRole: "MEMBER" });
    expect(names(forMember)).toEqual(["Active colleague", "Admin", "Guest", "Member", "Owner"].sort());

    const forGuest = await listWorkspacePeople({ orgId: w.org.id, workspaceId: ws.id, orgRole: "GUEST" });
    expect(names(forGuest)).toEqual(["Active colleague", "Guest", "Member"].sort());
  });
});

describe("analytics: the workload chart counts active people only", () => {
  it("a suspended person's open tasks stay in the totals but not in the per-person workload", async () => {
    const w = await world();
    const ws = await makeWorkspace(w.org.id, [{ userId: w.member.id }]);
    const made = await makeProject(ws.id);
    const seed = (assigneeId: string) =>
      makeTask({
        orgId: w.org.id,
        workspaceId: ws.id,
        projectId: made.project.id,
        boardId: made.board.id,
        columnId: made.todo.id,
        creatorId: w.owner.id,
        assigneeId,
      });
    await seed(w.active.id);
    await seed(w.suspended.id);
    await seed(w.suspended.id);
    await seed(w.gone.id);

    const data = await loadAnalytics(w.org.id, [ws.id]);
    expect(data.total).toBe(4);
    expect(data.open).toBe(4);
    expect(data.assignees.map((a) => a.assigneeId)).toEqual([w.active.id]);
    expect(data.nameOf.get(w.active.id)).toBe("Active colleague");
  });
});

describe("ideas: a membership that is not active gives no access to that organization's ideas", () => {
  it("voting as a member who is suspended in the idea's organization is refused (403), and nothing is stored", async () => {
    const home = await makeTeam();
    const other = await makeTeam();
    const idea = await db.idea.create({ data: { orgId: other.org.id, creatorId: other.owner.id, title: "Open a second shop" } });
    // active in their own organization (so they can sign in), suspended in the other one
    const person = await makeUser({ orgId: home.org.id, role: "MEMBER", name: "Two-company person" });
    const link = await db.organizationMember.create({
      data: { organizationId: other.org.id, userId: person.id, role: "MEMBER", status: "SUSPENDED" },
    });
    await loginAs(person.id);

    const refused = await call(voteRoute.POST, { params: { id: idea.id } });
    expect(refused.status).toBe(403);
    expect(await db.ideaVote.count({ where: { ideaId: idea.id } })).toBe(0);

    // once they are active there again it works
    await db.organizationMember.update({ where: { id: link.id }, data: { status: "ACTIVE" } });
    const allowed = await call(voteRoute.POST, { params: { id: idea.id } });
    expect(allowed.status).toBe(200);
    expect(await db.ideaVote.count({ where: { ideaId: idea.id } })).toBe(1);
  });
});

describe("n8n: the webhook acts as an ACTIVE owner", () => {
  async function inbound(orgId: string, work: { ws: string; project: string; board: string }) {
    await connectN8nDirect(orgId);
    const raw = JSON.stringify({
      action: "createTask",
      title: "From n8n",
      workspaceId: work.ws,
      projectId: work.project,
      boardId: work.board,
    });
    return handleInbound(orgId, { token: N8N_SECRET }, raw);
  }

  async function n8nWorld() {
    const team = await makeTeam();
    const ws = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }]);
    const made = await makeProject(ws.id);
    return { team, work: { ws: ws.id, project: made.project.id, board: made.board.id } };
  }

  it("with no active owner the webhook refuses to create anything", async () => {
    const { team, work } = await n8nWorld();
    await suspend(team.org.id, team.owner.id);
    const res = await inbound(team.org.id, work);
    expect(res).toMatchObject({ status: 503, body: { ok: false, error: "n8n.no_owner" } });
    expect(await db.task.count({ where: { orgId: team.org.id } })).toBe(0);
  });

  it("with two owners it takes the active one, even when the older one is suspended", async () => {
    const { team, work } = await n8nWorld();
    const second = await makeUser({ orgId: team.org.id, role: "OWNER", name: "Second owner" });
    await suspend(team.org.id, team.owner.id);
    const res = await inbound(team.org.id, work);
    expect(res.status).toBe(201);
    const task = await db.task.findFirstOrThrow({ where: { orgId: team.org.id } });
    expect(task.creatorId).toBe(second.id);
  });
});
