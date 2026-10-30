import { beforeEach, describe, expect, it } from "vitest";
import * as presenceRoute from "@/app/api/presence/route";
import { resetPresenceForTests, touchPresence } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeUser } from "./helpers";

/**
 * The people dock's route (the owner's ask, 2026-10-29): the company's staff with who is at their
 * screen. It is the staff directory, so a GUEST is refused and never sees a name; everybody else
 * gets the ACTIVE people who are not guests and not themselves, and «online» is the same presence
 * the chat's member pills read.
 */
describe("GET /api/presence — the people dock", () => {
  beforeEach(() => resetPresenceForTests());

  it("is refused to a GUEST, and the refusal names nobody", async () => {
    const team = await makeTeam();
    const mate = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Workspace mate" });
    await loginAs(team.guest.id);
    const res = await call(presenceRoute.GET);
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("Workspace mate");
    expect(res.text).not.toContain(mate.email);
  });

  it("lists the ACTIVE staff, the guests out, the viewer always at their screen", async () => {
    const team = await makeTeam();
    const mate = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Workspace mate" });
    const away = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Away person" });
    // a suspended colleague is nobody: their old row must not reach the dock
    const gone = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Suspended person" });
    await db.organizationMember.updateMany({ where: { userId: gone.id }, data: { status: "SUSPENDED" } });
    touchPresence(mate.id);

    await loginAs(team.member.id);
    const res = await call(presenceRoute.GET);
    expect(res.status).toBe(200);
    const people = res.json?.["people"] as { userId: string; name: string; online: boolean }[];
    // the answer says who is asking, so the screen never offers a chat with oneself
    expect(res.json?.["meId"]).toBe(team.member.id);
    const names = people.map((p) => p.name);
    expect(names).toContain("Workspace mate");
    expect(names).toContain("Away person");
    expect(names).toContain("Owner");
    // the person looking at the screen is on their own roster, and online
    expect(names).toContain("Member");
    expect(people.find((p) => p.userId === team.member.id)?.online).toBe(true);
    expect(names).not.toContain("Guest");
    expect(names).not.toContain("Suspended person");
    // whoever is at their screen comes first, and carries the flag
    expect(people[0]?.online).toBe(true);
    expect(people.find((p) => p.userId === mate.id)?.online).toBe(true);
    expect(people.find((p) => p.userId === away.id)?.online).toBe(false);
    expect(res.json?.["onlineCount"]).toBe(2);
  });

  it("answers an empty roster to somebody whose `directory.view` switch was taken away", async () => {
    const team = await makeTeam();
    await db.organizationMember.updateMany({
      where: { userId: team.member.id },
      data: { revokedCapabilities: ["directory.view"] },
    });
    await loginAs(team.member.id);
    const res = await call(presenceRoute.GET);
    expect(res.status).toBe(200);
    expect(res.json?.["people"]).toEqual([]);
    expect(res.json?.["onlineCount"]).toBe(0);
  });
});
