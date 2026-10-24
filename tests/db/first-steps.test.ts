import { describe, expect, it } from "vitest";
import { audienceOf } from "@/lib/guide/audience";
import { stepsFor } from "@/lib/guide/first-steps";
import { THEME_KEYS } from "@/lib/themes/registry";
import { requireActor } from "@/server/policy/actor";
import { getFirstSteps, type FirstStepsResult } from "@/server/services/first-steps";
import { db, loginAs, makeOrg, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/** The steps the signed-in person is shown, computed the way the page does it: from the real actor. */
async function stepsOf(userId: string, opts: { phase?: number } = {}): Promise<FirstStepsResult> {
  await loginAs(userId);
  return getFirstSteps(await requireActor(), opts);
}

const idsOf = (r: FirstStepsResult) => r.steps.map((s) => s.id);
const doneOf = (r: FirstStepsResult) => Object.fromEntries(r.steps.map((s) => [s.id, s.done]));

async function setMember(orgId: string, userId: string, data: Record<string, unknown>) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data });
}

/** An organization with its people, and one space with a project, a board and a done column. */
async function world() {
  const team = await makeTeam();
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead" });
  const ws = await makeWorkspace(team.org.id, [
    { userId: team.owner.id },
    { userId: team.admin.id },
    { userId: team.member.id },
    { userId: lead.id },
  ]);
  const board = await makeProject(ws.id);
  const task = (creatorId: string, extra: { assigneeId?: string | null; completedAt?: Date | null } = {}) =>
    makeTask({
      orgId: team.org.id,
      workspaceId: ws.id,
      projectId: board.project.id,
      boardId: board.board.id,
      columnId: extra.completedAt ? board.done.id : board.todo.id,
      creatorId,
      ...extra,
    });
  return { ...team, lead, ws, board, task };
}

describe("first steps: a new member", () => {
  it("is shown the six steps that apply to them (phase 3 adds «ابعت أول رسالة بـ«عام»»), none done, the install and guide steps left to the device", async () => {
    const w = await world();
    const r = await stepsOf(w.member.id);
    expect(r.audience).toBe("staff");
    expect(idsOf(r)).toEqual(["install", "theme", "first-message", "first-task", "finish-task", "open-guide"]);
    expect(Object.values(doneOf(r))).toEqual([false, false, false, false, false, false]);
    expect(r.steps.filter((s) => s.client).map((s) => s.id)).toEqual(["install", "open-guide"]);
    expect(r.steps.find((s) => s.id === "install")?.manual).toBe(true);
  });

  it("carries the keys and links the card needs, nothing about the database", async () => {
    const w = await world();
    const r = await stepsOf(w.member.id);
    for (const s of r.steps) {
      expect(Object.keys(s).sort()).toEqual(["client", "done", "hintKey", "href", "id", "manual", "titleKey"]);
      expect(s.href).toMatch(/^\//);
    }
    expect(JSON.stringify(r)).not.toContain(w.member.id);
    expect(JSON.stringify(r)).not.toContain(w.org.id);
  });
});

describe("first steps: choosing a theme (User.theme)", () => {
  it("is done only when the stored theme is one of the four keys", async () => {
    const w = await world();
    for (const key of THEME_KEYS) {
      await db.user.update({ where: { id: w.member.id }, data: { theme: key } });
      expect(doneOf(await stepsOf(w.member.id))["theme"], key).toBe(true);
    }
    // the retired «إسلامي هادي» was a choice too: it stays done (it is read as «ليل»)
    await db.user.update({ where: { id: w.member.id }, data: { theme: "islamic-calm" } });
    expect(doneOf(await stepsOf(w.member.id))["theme"], "islamic-calm").toBe(true);
    // the old light/dark/system toggle and anything else is no choice at all
    for (const value of ["system", "light", "dark", "", "Islamic-Calm", "nope"]) {
      await db.user.update({ where: { id: w.member.id }, data: { theme: value } });
      expect(doneOf(await stepsOf(w.member.id))["theme"], JSON.stringify(value)).toBe(false);
    }
  });
});

describe("first steps: the first task and the first finished task", () => {
  it("«أضف أول مهمة» is done once the person created a task, and «خلّص أول مهمة» is not", async () => {
    const w = await world();
    expect(doneOf(await stepsOf(w.member.id))["first-task"]).toBe(false);
    await w.task(w.member.id);
    const done = doneOf(await stepsOf(w.member.id));
    expect(done["first-task"]).toBe(true);
    expect(done["finish-task"]).toBe(false);
  });

  it("«خلّص أول مهمة» is done once a task of theirs (created by them and assigned to them, as the Today quick-add does) has been completed", async () => {
    const w = await world();
    await w.task(w.member.id, { assigneeId: w.member.id, completedAt: new Date() });
    const done = doneOf(await stepsOf(w.member.id));
    expect(done["first-task"]).toBe(true);
    expect(done["finish-task"]).toBe(true);
  });

  it("a task someone else created and gave them counts as finished when they complete it, but they did not add it", async () => {
    const w = await world();
    await w.task(w.admin.id, { assigneeId: w.member.id, completedAt: new Date() });
    const done = doneOf(await stepsOf(w.member.id));
    expect(done["finish-task"]).toBe(true);
    expect(done["first-task"]).toBe(false);
  });

  it("a task that is only assigned to them and still open is neither", async () => {
    const w = await world();
    await w.task(w.admin.id, { assigneeId: w.member.id });
    const done = doneOf(await stepsOf(w.member.id));
    expect(done["first-task"]).toBe(false);
    expect(done["finish-task"]).toBe(false);
  });

  it("a colleague's work never counts for someone else", async () => {
    const w = await world();
    await w.task(w.admin.id, { completedAt: new Date() });
    await w.task(w.lead.id, { assigneeId: w.lead.id, completedAt: new Date() });
    const done = doneOf(await stepsOf(w.member.id));
    expect(done["first-task"]).toBe(false);
    expect(done["finish-task"]).toBe(false);
  });

  it("an archived task was still created by them and finished while assigned to them", async () => {
    const w = await world();
    const t = await w.task(w.member.id, { assigneeId: w.member.id, completedAt: new Date() });
    await db.task.update({ where: { id: t.id }, data: { archived: true } });
    const done = doneOf(await stepsOf(w.member.id));
    expect(done["first-task"]).toBe(true);
    expect(done["finish-task"]).toBe(true);
  });

  it("work in another company does not count: the steps are about the company they work in now", async () => {
    const w = await world();
    // a second, newer company where this person also works and has done everything
    const other = await makeOrg({ name: "Other company" });
    await db.organizationMember.create({ data: { organizationId: other.id, userId: w.member.id, role: "MEMBER" } });
    const otherOwner = await makeUser({ orgId: other.id, role: "OWNER", name: "Other owner" });
    const otherWs = await makeWorkspace(other.id, [{ userId: w.member.id }, { userId: otherOwner.id }]);
    const otherBoard = await makeProject(otherWs.id);
    await makeTask({
      orgId: other.id,
      workspaceId: otherWs.id,
      projectId: otherBoard.project.id,
      boardId: otherBoard.board.id,
      columnId: otherBoard.done.id,
      creatorId: w.member.id,
      assigneeId: w.member.id,
      completedAt: new Date(),
    });
    const done = doneOf(await stepsOf(w.member.id));
    expect(done["first-task"]).toBe(false);
    expect(done["finish-task"]).toBe(false);
  });
});

describe("first steps: the owner and the people managers", () => {
  it("the owner gets the two people steps first, then the rest", async () => {
    const w = await world();
    const r = await stepsOf(w.owner.id);
    expect(r.audience).toBe("managers");
    expect(idsOf(r)).toEqual(["add-person", "review-spaces", "install", "theme", "first-message", "first-task", "finish-task", "open-guide"]);
  });

  it("«ضيف أول موظف» needs a second ACTIVE person in the company; the owner alone has not added anyone", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER", name: "Owner" });
    expect(doneOf(await stepsOf(owner.id))["add-person"]).toBe(false);

    // a suspended or offboarded person is not a colleague who can use the app
    const gone = await makeUser({ orgId: org.id, role: "MEMBER", name: "Gone" });
    await setMember(org.id, gone.id, { status: "SUSPENDED" });
    expect(doneOf(await stepsOf(owner.id))["add-person"]).toBe(false);
    await setMember(org.id, gone.id, { status: "OFFBOARDED" });
    expect(doneOf(await stepsOf(owner.id))["add-person"]).toBe(false);

    // the first active colleague ticks it
    await makeUser({ orgId: org.id, role: "MEMBER", name: "First colleague" });
    expect(doneOf(await stepsOf(owner.id))["add-person"]).toBe(true);
  });

  it("«راجع المساحات» is done for the owner (who opens every space) once the company has one, and not before", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER", name: "Owner" });
    expect(doneOf(await stepsOf(owner.id))["review-spaces"]).toBe(false);
    await makeWorkspace(org.id, []);
    expect(doneOf(await stepsOf(owner.id))["review-spaces"]).toBe(true);
  });

  it("a space of another company does not count", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER", name: "Owner" });
    const other = await makeOrg();
    await makeWorkspace(other.id, []);
    expect(doneOf(await stepsOf(owner.id))["review-spaces"]).toBe(false);
  });

  it("the owner with colleagues and a space has both people steps done", async () => {
    const w = await world();
    const done = doneOf(await stepsOf(w.owner.id));
    expect(done["add-person"]).toBe(true);
    expect(done["review-spaces"]).toBe(true);
  });

  it("an admin is a people manager by default, a team lead and a plain member are not", async () => {
    const w = await world();
    expect(idsOf(await stepsOf(w.admin.id))).toContain("add-person");
    expect(idsOf(await stepsOf(w.lead.id))).not.toContain("add-person");
    expect(idsOf(await stepsOf(w.member.id))).not.toContain("add-person");
    expect(idsOf(await stepsOf(w.member.id))).not.toContain("review-spaces");
  });

  it("the switch decides, not the rank: users.manage on gives a member the people steps, off takes them from an admin", async () => {
    const w = await world();
    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    expect(idsOf(await stepsOf(w.member.id))).toEqual(["add-person", "review-spaces", "install", "theme", "first-message", "first-task", "finish-task", "open-guide"]);
    await setMember(w.org.id, w.admin.id, { revokedCapabilities: ["users.manage"] });
    expect(idsOf(await stepsOf(w.admin.id))).toEqual(["install", "theme", "first-message", "first-task", "finish-task", "open-guide"]);
  });
});

describe("first steps: an external partner (guest)", () => {
  it("gets only the steps that apply: install, theme and the guide — no tasks to add, no people to invite", async () => {
    const w = await world();
    const r = await stepsOf(w.guest.id);
    expect(r.audience).toBe("everyone");
    expect(idsOf(r)).toEqual(["install", "theme", "open-guide"]);
  });

  it("choosing a theme still ticks their theme step", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.guest.id }, data: { theme: "day" } });
    expect(doneOf(await stepsOf(w.guest.id))["theme"]).toBe(true);
  });

  it("whatever rows a guest has, they are never shown the task steps (a guest cannot write)", async () => {
    const w = await world();
    // an old assignment left behind from before they became a guest
    await w.task(w.admin.id, { assigneeId: w.guest.id, completedAt: new Date() });
    expect(idsOf(await stepsOf(w.guest.id))).not.toContain("finish-task");
  });
});

describe("first steps: phases", () => {
  it("nothing is shown before the phase the steps exist in, phase 2 lacks only the chat's step, and today's phase shows them all", async () => {
    const w = await world();
    expect((await stepsOf(w.owner.id, { phase: 1 })).steps).toEqual([]);
    expect(idsOf(await stepsOf(w.owner.id, { phase: 2 }))).toEqual(idsOf(await stepsOf(w.owner.id)).filter((id) => id !== "first-message"));
    expect(idsOf(await stepsOf(w.owner.id, { phase: 3 }))).toEqual(idsOf(await stepsOf(w.owner.id)));
  });

  it("the steps returned are exactly the registry's for that audience", async () => {
    const w = await world();
    for (const [who, level] of [
      [w.guest, "everyone"],
      [w.member, "staff"],
      [w.owner, "managers"],
    ] as const) {
      expect(idsOf(await stepsOf(who.id))).toEqual(stepsFor(level).map((s) => s.id));
    }
  });
});

describe("audienceOf on real actors", () => {
  it("derives the guide level from the rank and the switches", async () => {
    const w = await world();
    const level = async (userId: string) => {
      await loginAs(userId);
      return audienceOf(await requireActor());
    };
    expect(await level(w.guest.id)).toBe("everyone");
    expect(await level(w.member.id)).toBe("staff");
    expect(await level(w.lead.id)).toBe("staff");
    expect(await level(w.admin.id)).toBe("managers");
    expect(await level(w.owner.id)).toBe("managers");
    await setMember(w.org.id, w.lead.id, { capabilities: ["users.manage"] });
    expect(await level(w.lead.id)).toBe("managers");
    await setMember(w.org.id, w.admin.id, { revokedCapabilities: ["users.manage"] });
    expect(await level(w.admin.id)).toBe("staff");
  });
});

describe("first steps: «ابعت أول رسالة بـ«عام»»", () => {
  it("is done once the person wrote a chat message in this company; a system line («انضم») is not one", async () => {
    const w = await world();
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "عام" } });
    expect(doneOf(await stepsOf(w.member.id))["first-message"]).toBe(false);

    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: topic.id, authorId: w.member.id, body: JSON.stringify({ k: "join", p: {} }), kind: "SYSTEM" } });
    expect(doneOf(await stepsOf(w.member.id))["first-message"]).toBe(false);

    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: topic.id, authorId: w.member.id, body: "مرحبا يا فريق" } });
    expect(doneOf(await stepsOf(w.member.id))["first-message"]).toBe(true);
    // a colleague's message never counts for someone else
    expect(doneOf(await stepsOf(w.admin.id))["first-message"]).toBe(false);
  });
});
