import { db, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * A space split into two teams, for the tests of teams inside a space (src/server/services/team-scope.ts):
 *
 *   space S:  admin  (space ADMIN — a manager: sees every team)
 *             alice  (team X)      bob (team Y)      carol (no team)
 *   projects: p0 (the space as a whole), px (team X), py (team Y), each with one board and one open task
 *   space T:  a second space alice is NOT in, with its own project and task (the old task-list leak)
 *   space U:  a space with no team at all, alice and carol in it (must read exactly as before)
 */
export async function makeTeamsWorld() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const [alice, bob, carol, spaceAdmin] = await Promise.all([
    makeUser({ orgId, role: "MEMBER", name: "Alice" }),
    makeUser({ orgId, role: "MEMBER", name: "Bob" }),
    makeUser({ orgId, role: "MEMBER", name: "Carol" }),
    makeUser({ orgId, role: "MEMBER", name: "Space admin" }),
  ]);
  const s = await makeWorkspace(
    orgId,
    [
      { userId: alice.id, role: "MEMBER" },
      { userId: bob.id, role: "MEMBER" },
      { userId: carol.id, role: "MEMBER" },
      { userId: spaceAdmin.id, role: "ADMIN" },
    ],
    `S ${uid()}`,
  );
  const x = await db.team.create({ data: { workspaceId: s.id, name: `X ${uid()}`, members: { create: [{ userId: alice.id }] } } });
  const y = await db.team.create({ data: { workspaceId: s.id, name: `Y ${uid()}`, members: { create: [{ userId: bob.id }] } } });

  const p0 = await makeProject(s.id, `P0 ${uid()}`);
  const px = await makeProject(s.id, `PX ${uid()}`);
  const py = await makeProject(s.id, `PY ${uid()}`);
  await db.project.update({ where: { id: px.project.id }, data: { teamId: x.id } });
  await db.project.update({ where: { id: py.project.id }, data: { teamId: y.id } });

  const task = (p: Awaited<ReturnType<typeof makeProject>>, title: string, assigneeId: string | null = null) =>
    makeTask({ orgId, workspaceId: s.id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: team.owner.id, title, assigneeId });
  const t0 = await task(p0, `T0 ${uid()}`);
  const tx = await task(px, `TX ${uid()}`, alice.id);
  const ty = await task(py, `TY ${uid()}`, bob.id);

  const other = await makeWorkspace(orgId, [{ userId: bob.id, role: "MEMBER" }], `T ${uid()}`);
  const pt = await makeProject(other.id, `PT ${uid()}`);
  const tt = await makeTask({ orgId, workspaceId: other.id, projectId: pt.project.id, boardId: pt.board.id, columnId: pt.todo.id, creatorId: team.owner.id, title: `TT ${uid()}` });

  const plain = await makeWorkspace(orgId, [{ userId: alice.id }, { userId: carol.id }], `U ${uid()}`);
  const pu = await makeProject(plain.id, `PU ${uid()}`);
  const tu = await makeTask({ orgId, workspaceId: plain.id, projectId: pu.project.id, boardId: pu.board.id, columnId: pu.todo.id, creatorId: team.owner.id, title: `TU ${uid()}` });

  return { ...team, alice, bob, carol, spaceAdmin, s, x, y, p0, px, py, t0, tx, ty, other, pt, tt, plain, pu, tu };
}

export type TeamsWorld = Awaited<ReturnType<typeof makeTeamsWorld>>;
