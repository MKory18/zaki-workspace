import { describe, expect, it } from "vitest";
import * as workspaceRoute from "@/app/api/workspaces/[id]/route";
import * as wsMembersRoute from "@/app/api/workspaces/[id]/members/route";
import * as commentsRoute from "@/app/api/tasks/[id]/comments/route";
import * as ideasRoute from "@/app/api/ideas/route";
import * as ideaRoute from "@/app/api/ideas/[id]/route";
import * as ideaConvertRoute from "@/app/api/ideas/[id]/convert/route";
import * as opportunitiesRoute from "@/app/api/crm/opportunities/route";
import * as customerRoute from "@/app/api/crm/customers/[id]/route";
import * as conversationsRoute from "@/app/api/chat/conversations/route";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { call, db, loginAs, makeOrg, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { accountsApi, grantCapabilities, makeRankTeam, memberRow, reason, username } from "./accounts-helpers";
import { makeCustomer, makeOpportunity } from "./guest-helpers";

/**
 * Independent review (reviewer B) of Phase 1's authorization model. Every test here asserts the
 * behaviour the rules PROMISE; a test that fails is a proven finding, not a flaky one. Nothing in
 * src/ was touched for these.
 */

/** A space the lead is NOT in, with one open task held by the plain member. */
async function secretSpaceWorld() {
  const t = await makeRankTeam();
  const secret = await makeWorkspace(t.org.id, [{ userId: t.member.id }], "Secret space");
  const p = await makeProject(secret.id);
  const task = await makeTask({
    orgId: t.org.id,
    workspaceId: secret.id,
    projectId: p.project.id,
    boardId: p.board.id,
    columnId: p.todo.id,
    creatorId: t.owner.id,
    assigneeId: t.member.id,
    title: "Confidential work",
  });
  return { ...t, secret, task, project: p };
}

const rowIn = (workspaceId: string, userId: string) =>
  db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });

/**
 * Left out on purpose (documented in docs/PHASE0-AUDIT.md, residual risks):
 *  - "rank defaults must not hand out a capability the creator does not hold": rewritten for the
 *    strictly-below rank rule in tests/db/accounts-review.test.ts;
 *  - "prices.view is offered as a switch but changes nothing": the switch is no longer offered until
 *    a phase wires it (R12);
 *  - "a person in two companies": single-company product today (R9).
 */

describe("review-b: offboarding's work transfer must not open a space to somebody who is not in it", () => {
  it("a LEAD with users.manage cannot enter a space by offboarding a colleague and taking their open work", async () => {
    const w = await secretSpaceWorld();
    await grantCapabilities(w.org.id, w.lead.id, ["users.manage"]);
    await loginAs(w.lead.id);
    expect((await call(workspaceRoute.GET, { params: { id: w.secret.id } })).status).toBe(403);

    const res = await accountsApi.status(w.org.id, w.member.id, { action: "offboard", transferToUserId: w.lead.id });
    // whatever the route answers, the invariant is: the lead is still outside the space afterwards
    expect(await rowIn(w.secret.id, w.lead.id), `offboard answered ${res.status} ${reason(res) ?? ""}`).toBeNull();
    expect((await call(workspaceRoute.GET, { params: { id: w.secret.id } })).status).toBe(403);
  });

  it("an ADMIN (users.manage by rank) who is not in the space cannot enter it the same way - rank opens no space", async () => {
    const w = await secretSpaceWorld();
    await loginAs(w.admin.id);
    expect((await call(workspaceRoute.GET, { params: { id: w.secret.id } })).status).toBe(403);

    const res = await accountsApi.status(w.org.id, w.member.id, { action: "offboard", transferToUserId: w.admin.id });
    expect(await rowIn(w.secret.id, w.admin.id), `offboard answered ${res.status} ${reason(res) ?? ""}`).toBeNull();
    expect((await call(workspaceRoute.GET, { params: { id: w.secret.id } })).status).toBe(403);
  });

  it("nor can they hand the work (and the space) to an accomplice who is not in it either", async () => {
    const w = await secretSpaceWorld();
    const accomplice = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Accomplice" });
    await loginAs(w.admin.id);
    const res = await accountsApi.status(w.org.id, w.member.id, { action: "offboard", transferToUserId: accomplice.id });
    expect(await rowIn(w.secret.id, accomplice.id), `offboard answered ${res.status} ${reason(res) ?? ""}`).toBeNull();
  });
});

describe("review-b: equal-rank administration is a peer takeover", () => {
  it("a MEMBER holding users.manage cannot reset the password of (= sign in as) a peer MEMBER who holds a capability they lack", async () => {
    const t = await makeRankTeam();
    const peer = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Peer with more" });
    await grantCapabilities(t.org.id, t.member.id, ["users.manage"]);
    await grantCapabilities(t.org.id, peer.id, ["integrations.manage"]); // the owner's decision
    await loginAs(t.member.id);
    const reset = await accountsApi.password(t.org.id, peer.id);
    expect(reset.status, reason(reset)).toBe(403);
    expect(reset.json?.["temporaryPassword"]).toBeUndefined();
  });

  it("two LEADs holding users.manage cannot suspend each other (a peer is not 'below')", async () => {
    const t = await makeRankTeam();
    const other = await makeUser({ orgId: t.org.id, role: "LEAD", name: "Other lead" });
    await grantCapabilities(t.org.id, t.lead.id, ["users.manage"]);
    await loginAs(t.lead.id);
    const res = await accountsApi.status(t.org.id, other.id, { action: "suspend" });
    expect(res.status, reason(res)).toBe(403);
    expect((await memberRow(t.org.id, other.id)).status).toBe("ACTIVE");
  });
});

describe("review-b: an external partner (org GUEST) never writes", () => {
  it("a GUEST with a row in the space cannot comment on a task (and nobody is notified of a comment)", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.guest.id, role: "GUEST" }]);
    const p = await makeProject(ws.id);
    const task = await makeTask({
      orgId: t.org.id,
      workspaceId: ws.id,
      projectId: p.project.id,
      boardId: p.board.id,
      columnId: p.todo.id,
      creatorId: t.member.id,
      assigneeId: t.member.id,
    });
    await loginAs(t.guest.id);
    const res = await call(commentsRoute.POST, { params: { id: task.id }, body: { body: "planted by the partner" } });
    expect(res.status).toBe(403);
    expect(await db.taskComment.count({ where: { taskId: task.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: t.member.id, type: "comment" } })).toBe(0);
  });

  /** A member writes an idea, then the owner demotes them to GUEST through the real route. */
  async function demotedAuthor() {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }]);
    const p = await makeProject(ws.id);
    await loginAs(t.member.id);
    const created = await call(ideasRoute.POST, { body: { title: "Idea from staff days" } });
    expect(created.status, reason(created)).toBe(201);
    const ideaId = (created.json!["idea"] as { id: string }).id;
    await loginAs(t.owner.id);
    const demoted = await accountsApi.update(t.org.id, t.member.id, { role: "GUEST" });
    expect(demoted.status, reason(demoted)).toBe(200);
    await loginAs(t.member.id);
    return { ...t, ws, project: p, ideaId };
  }

  it("a member demoted to GUEST cannot edit the idea they wrote as a member", async () => {
    const w = await demotedAuthor();
    const edit = await call(ideaRoute.PATCH, { method: "PATCH", params: { id: w.ideaId }, body: { title: "Edited as a guest" } });
    expect(edit.status).toBe(403);
    expect((await db.idea.findUniqueOrThrow({ where: { id: w.ideaId } })).title).toBe("Idea from staff days");
  });

  it("...nor convert it into a task (a guest creating a task through the side door)", async () => {
    const w = await demotedAuthor();
    const convert = await call(ideaConvertRoute.POST, {
      params: { id: w.ideaId },
      body: { workspaceId: w.ws.id, projectId: w.project.project.id, boardId: w.project.board.id },
    });
    expect(convert.status).toBe(403);
    expect(await db.task.count({ where: { workspaceId: w.ws.id } })).toBe(0);
  });

  it("...nor delete it", async () => {
    const w = await demotedAuthor();
    const del = await call(ideaRoute.DELETE, { method: "DELETE", params: { id: w.ideaId } });
    expect(del.status).toBe(403);
    expect(await db.idea.count({ where: { id: w.ideaId } })).toBe(1);
  });

  it("a GUEST gets 403 on the ideas board (WP-ACCESS: ideas are staff-only), so no job titles leak", async () => {
    const t = await makeTeam();
    await db.user.update({ where: { id: t.member.id }, data: { jobTitle: "Head of Secret Projects" } });
    await db.idea.create({ data: { orgId: t.org.id, creatorId: t.member.id, title: "An idea" } });
    await loginAs(t.guest.id);
    const res = await call(ideasRoute.GET, { url: "http://localhost/api/ideas" });
    expect(res.status).toBe(403); // was 200 before WP-ACCESS: guests are refused outright now
    expect(res.text).not.toContain("Head of Secret Projects");
  });
});

describe("review-b: putting a new account into a space follows the space's own rule", () => {
  it("a LEAD with users.manage who is only a plain MEMBER of a space cannot put a new account into it (the members route refuses them)", async () => {
    const t = await makeRankTeam();
    await grantCapabilities(t.org.id, t.lead.id, ["users.manage"]);
    const ws = await makeWorkspace(t.org.id, [
      { userId: t.lead.id, role: "MEMBER" },
      { userId: t.member.id, role: "ADMIN" },
    ]);
    await loginAs(t.lead.id);
    const direct = await call(wsMembersRoute.POST, { params: { id: ws.id }, body: { addUserIds: [t.guest.id] } });
    expect(direct.status).toBe(403); // the space's own door
    const res = await accountsApi.create(t.org.id, { name: "Planted person", username: username("planted"), workspaceIds: [ws.id] });
    expect(res.status, reason(res)).toBe(403);
    expect(await db.workspaceMember.count({ where: { workspaceId: ws.id } })).toBe(2);
  });
});

describe("review-b: nothing new reaches a person who is out", () => {
  it("a comment on a task created by an offboarded person does not land in their notifications", async () => {
    const t = await makeRankTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.lead.id }]);
    const p = await makeProject(ws.id);
    const task = await makeTask({
      orgId: t.org.id,
      workspaceId: ws.id,
      projectId: p.project.id,
      boardId: p.board.id,
      columnId: p.todo.id,
      creatorId: t.member.id,
      assigneeId: t.lead.id,
    });
    await loginAs(t.owner.id);
    const off = await accountsApi.status(t.org.id, t.member.id, { action: "offboard" });
    expect(off.status, reason(off)).toBe(200);
    await loginAs(t.lead.id);
    const res = await call(commentsRoute.POST, { params: { id: task.id }, body: { body: "confidential follow-up" } });
    expect(res.status).toBe(201);
    expect(await db.notification.findMany({ where: { userId: t.member.id, type: "comment" }, select: { body: true } })).toEqual([]);
  });

  it("a person offboarded (removed from everything) and later reactivated is not silently back in the group chats", async () => {
    const t = await makeRankTeam();
    const conv = await db.conversation.create({
      data: {
        orgId: t.org.id,
        kind: "GROUP",
        title: "Leadership",
        members: { create: [{ userId: t.owner.id, role: "admin" }, { userId: t.member.id }] },
      },
    });
    await loginAs(t.owner.id);
    expect((await accountsApi.status(t.org.id, t.member.id, { action: "offboard" })).status).toBe(200);
    await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: conv.id, authorId: t.owner.id, body: "while they were gone" } });
    expect((await accountsApi.status(t.org.id, t.member.id, { action: "reactivate" })).status).toBe(200);
    // they finish the onboarding again (temporary password changed), then open the chat list
    await db.user.update({ where: { id: t.member.id }, data: { mustChangePassword: false } });
    await loginAs(t.member.id);
    const list = await call(conversationsRoute.GET);
    expect(list.status).toBe(200);
    expect(list.json!["conversations"]).toEqual([]);
  });
});

describe("review-b: concurrency", () => {
  it("two manager changes at the very same moment cannot close a loop", async () => {
    const t = await makeRankTeam();
    const a = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "A" });
    const b = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "B" });
    await loginAs(t.owner.id);
    const [r1, r2] = await Promise.all([
      accountsApi.update(t.org.id, a.id, { managerId: b.id }),
      accountsApi.update(t.org.id, b.id, { managerId: a.id }),
    ]);
    const ra = await memberRow(t.org.id, a.id);
    const rb = await memberRow(t.org.id, b.id);
    expect(ra.managerId === b.id && rb.managerId === a.id, `answers ${r1.status}/${r2.status}`).toBe(false);
  });

  it("two accounts created at the same moment with the same username: exactly one exists, the other is a 409", async () => {
    const t = await makeTeam();
    await loginAs(t.owner.id);
    const name = username("race");
    const [r1, r2] = await Promise.all([
      accountsApi.create(t.org.id, { name: "Racer one", username: name }),
      accountsApi.create(t.org.id, { name: "Racer two", username: name }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await db.user.count({ where: { username: name } })).toBe(1);
  });
});

