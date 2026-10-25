import { describe, expect, it } from "vitest";
import * as teamsRoute from "@/app/api/workspaces/[id]/teams/route";
import * as teamRoute from "@/app/api/workspaces/[id]/teams/[teamId]/route";
import * as teamMembersRoute from "@/app/api/workspaces/[id]/teams/[teamId]/members/route";
import * as spaceMembersRoute from "@/app/api/workspaces/[id]/members/route";
import { call, db, loginAs, makeUser } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

/** Managing the teams of a space (src/server/services/teams.ts): who may, who may join, what leaving does. */

describe("who sees and who manages the teams", () => {
  it("a manager sees every team and may manage; a member sees only their own teams, read-only", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.spaceAdmin.id);
    const forAdmin = await call(teamsRoute.GET, { params: { id: w.s.id } });
    expect((forAdmin.json?.["teams"] as Array<{ id: string }>).map((t) => t.id).sort()).toEqual([w.x.id, w.y.id].sort());
    expect(forAdmin.json?.["canManage"]).toBe(true);

    await loginAs(w.alice.id);
    const forAlice = await call(teamsRoute.GET, { params: { id: w.s.id } });
    expect((forAlice.json?.["teams"] as Array<{ id: string }>).map((t) => t.id)).toEqual([w.x.id]);
    expect(forAlice.json?.["canManage"]).toBe(false);
  });

  it("a member cannot open, rename, delete or fill a team", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.alice.id);
    expect((await call(teamsRoute.POST, { params: { id: w.s.id }, body: { name: "Mine" } })).status).toBe(403);
    expect((await call(teamRoute.PATCH, { method: "PATCH", params: { id: w.s.id, teamId: w.x.id }, body: { name: "Renamed" } })).status).toBe(403);
    expect((await call(teamMembersRoute.POST, { params: { id: w.s.id, teamId: w.x.id }, body: { add: [w.carol.id] } })).status).toBe(403);
  });
});

describe("creating and changing a team", () => {
  it("a manager opens a team with people of the space; the name is unique in the space (409)", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.spaceAdmin.id);
    const made = await call(teamsRoute.POST, { params: { id: w.s.id }, body: { name: "Design", memberIds: [w.carol.id] } });
    expect(made.status).toBe(201);
    const id = (made.json?.["team"] as { id: string }).id;
    expect(await db.teamMember.count({ where: { teamId: id, userId: w.carol.id } })).toBe(1);
    expect((await call(teamsRoute.POST, { params: { id: w.s.id }, body: { name: "design" } })).status).toBe(409);
  });

  it("only people of the space may join one of its teams", async () => {
    const w = await makeTeamsWorld();
    const stranger = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Not in S" });
    await loginAs(w.spaceAdmin.id);
    const res = await call(teamMembersRoute.POST, { params: { id: w.s.id, teamId: w.x.id }, body: { add: [stranger.id] } });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("teams.member_not_in_space");
  });

  it("leaving a team hands back the open tasks one held in its projects", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.spaceAdmin.id);
    const res = await call(teamMembersRoute.POST, { params: { id: w.s.id, teamId: w.x.id }, body: { remove: [w.alice.id] } });
    expect(res.status).toBe(200);
    expect(res.json?.["unassigned"]).toBe(1);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.tx.id }, select: { assigneeId: true } })).assigneeId).toBeNull();
    expect(await db.teamMember.count({ where: { teamId: w.x.id, userId: w.alice.id } })).toBe(0);
  });

  it("a team with work in it is not deleted (409); an empty one is", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.spaceAdmin.id);
    const busy = await call(teamRoute.DELETE, { method: "DELETE", params: { id: w.s.id, teamId: w.x.id } });
    expect(busy.status).toBe(409);
    expect(busy.json?.["message"]).toBe("teams.not_empty");
    const empty = await db.team.create({ data: { workspaceId: w.s.id, name: "Empty" } });
    expect((await call(teamRoute.DELETE, { method: "DELETE", params: { id: w.s.id, teamId: empty.id } })).status).toBe(200);
    expect(await db.team.count({ where: { id: empty.id } })).toBe(0);
  });

  it("leaving the space takes one out of its teams (and their lead)", async () => {
    const w = await makeTeamsWorld();
    await db.team.update({ where: { id: w.x.id }, data: { leadId: w.alice.id } });
    await loginAs(w.spaceAdmin.id);
    expect((await call(spaceMembersRoute.POST, { params: { id: w.s.id }, body: { removeUserIds: [w.alice.id] } })).status).toBe(200);
    expect(await db.teamMember.count({ where: { userId: w.alice.id, team: { workspaceId: w.s.id } } })).toBe(0);
    expect((await db.team.findUniqueOrThrow({ where: { id: w.x.id }, select: { leadId: true } })).leadId).toBeNull();
  });
});
