import { describe, expect, it } from "vitest";
import { PATCH } from "@/app/api/tasks/[id]/route";
import { db, loginAs, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";
import { setZone } from "./today-helpers";

/**
 * B5 (Phase B review, fixed in Phase E): a due date is the day a person PICKED, in the company's zone.
 *
 * The old date box did `new Date("2026-11-05T12:00:00").toISOString()` in the BROWSER, so a machine set
 * to UTC saved 12:00 UTC for a company in Damascus — a day that belongs to nobody. The screens now send
 * the plain day and the server turns it into noon in the company's zone; this is that server half, and
 * it must not depend on the clock of whatever machine runs it.
 */
async function world(timezone: string) {
  const team = await makeTeam();
  await setZone(team.org.id, timezone);
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
  const made = await makeProject(ws.id);
  const task = await makeTask({
    orgId: team.org.id,
    workspaceId: ws.id,
    projectId: made.project.id,
    boardId: made.board.id,
    columnId: made.todo.id,
    creatorId: team.owner.id,
  });
  await loginAs(team.member.id);
  return { ...team, task };
}

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  );

describe("the API stores a picked day in the company's zone", () => {
  it("a plain day becomes noon in the company's zone, whatever the server's clock is", async () => {
    const w = await world("Asia/Damascus");
    const res = await patch(w.task.id, { dueDate: "2026-11-05" });
    expect(res.status).toBe(200);
    const stored = await db.task.findUnique({ where: { id: w.task.id }, select: { dueDate: true } });
    // noon in Damascus (UTC+3 in November) — not noon UTC, and not noon in whatever zone the runner is in
    expect(stored?.dueDate?.toISOString()).toBe("2026-11-05T09:00:00.000Z");
  });

  it("a full instant is still taken as it is (an integration that knows its own moment)", async () => {
    const w = await world("Asia/Damascus");
    const res = await patch(w.task.id, { dueDate: "2026-11-05T14:30:00.000Z" });
    expect(res.status).toBe(200);
    const stored = await db.task.findUnique({ where: { id: w.task.id }, select: { dueDate: true } });
    expect(stored?.dueDate?.toISOString()).toBe("2026-11-05T14:30:00.000Z");
  });

  it("clearing the day clears it", async () => {
    const w = await world("Asia/Damascus");
    await patch(w.task.id, { dueDate: "2026-11-05" });
    const res = await patch(w.task.id, { dueDate: null });
    expect(res.status).toBe(200);
    const stored = await db.task.findUnique({ where: { id: w.task.id }, select: { dueDate: true } });
    expect(stored?.dueDate).toBeNull();
  });

  it("two companies three hours apart store the same day differently, and each reads back its own day", async () => {
    const damascus = await world("Asia/Damascus");
    expect((await patch(damascus.task.id, { dueDate: "2026-11-05" })).status).toBe(200);
    const utc = await world("UTC");
    expect((await patch(utc.task.id, { dueDate: "2026-11-05" })).status).toBe(200);
    const a = await db.task.findUnique({ where: { id: damascus.task.id }, select: { dueDate: true } });
    const b = await db.task.findUnique({ where: { id: utc.task.id }, select: { dueDate: true } });
    expect(a?.dueDate?.toISOString()).toBe("2026-11-05T09:00:00.000Z");
    expect(b?.dueDate?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
  });
});
