import { describe, expect, it } from "vitest";
import { requireActor } from "@/server/policy/actor";
import { getFirstSteps, type FirstStepsResult } from "@/server/services/first-steps";
import { db, loginAs, makeOrg, makeProject, makeTask, makeUser, makeWorkspace } from "./helpers";

/**
 * WP-ACCESS (review C, item 8): a first step («خطواتك الأولى») is ticked only by the person's OWN work, over what
 * THEY can see - never by somebody else's work, by a guest, or by a space they cannot open (which would also tell
 * them that it exists). Each case has its positive twin, so the step is shown to the person and can be done.
 */

/** The steps the signed-in person is shown, computed the way the page does it: from the real actor. */
async function stepsOf(userId: string): Promise<FirstStepsResult> {
  await loginAs(userId);
  return getFirstSteps(await requireActor());
}

const doneOf = (r: FirstStepsResult) => Object.fromEntries(r.steps.map((s) => [s.id, s.done]));

describe("first steps are ticked by the person's own work, over what they can see", () => {
  it("«راجع المساحات»: an ADMIN in no space is not done while the company has one; once put in it, they are", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER", name: "Owner" });
    const admin = await makeUser({ orgId: org.id, role: "ADMIN", name: "Admin" });
    const member = await makeUser({ orgId: org.id, role: "MEMBER", name: "Member" });
    const space = await makeWorkspace(org.id, [{ userId: member.id }]);

    const adminSteps = await stepsOf(admin.id);
    expect(adminSteps.steps.map((s) => s.id)).toContain("review-spaces"); // a people manager is asked to do it
    expect(doneOf(adminSteps)["review-spaces"]).toBe(false); // an ADMIN opens no space by rank
    expect(doneOf(await stepsOf(owner.id))["review-spaces"]).toBe(true); // the owner opens every space

    await db.workspaceMember.create({ data: { workspaceId: space.id, userId: admin.id, role: "MEMBER" } });
    expect(doneOf(await stepsOf(admin.id))["review-spaces"]).toBe(true);
  });

  it("«ضيف أول موظف»: a company with only the owner and a guest has not added anybody to the team", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER", name: "Owner" });
    await makeUser({ orgId: org.id, role: "GUEST", name: "Partner" });
    expect(doneOf(await stepsOf(owner.id))["add-person"]).toBe(false);

    // the first colleague who is not an external partner ticks it
    await makeUser({ orgId: org.id, role: "MEMBER", name: "First colleague" });
    expect(doneOf(await stepsOf(owner.id))["add-person"]).toBe(true);
  });

  it("«خلّص أول مهمة»: a colleague finishing a task the owner CREATED does not tick it for the owner, it does for the colleague", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER", name: "Owner" });
    const colleague = await makeUser({ orgId: org.id, role: "MEMBER", name: "Colleague" });
    const space = await makeWorkspace(org.id, [{ userId: colleague.id }]);
    const { project, board, done } = await makeProject(space.id);
    await makeTask({
      orgId: org.id,
      workspaceId: space.id,
      projectId: project.id,
      boardId: board.id,
      columnId: done.id,
      creatorId: owner.id,
      assigneeId: colleague.id,
      completedAt: new Date(),
    });

    const owners = doneOf(await stepsOf(owner.id));
    expect(owners["first-task"]).toBe(true); // the owner did add a task
    expect(owners["finish-task"]).toBe(false); // but did not finish one
    expect(doneOf(await stepsOf(colleague.id))["finish-task"]).toBe(true);
  });
});
