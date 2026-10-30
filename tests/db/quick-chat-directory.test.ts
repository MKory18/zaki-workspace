import { describe, expect, it } from "vitest";
import * as directoryRoute from "@/app/api/chat/directory/route";
import { call, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * The list behind the floating quick chat (the owner's ask, 2026-10-30): «بس تضغط عليها يظهور
 * الاعضاء». It is the WHOLE company — unlike the chat's own picker, which is the space the person is
 * in — and every row says whether a private message can be opened with that person here
 * (`openDm`: `chat.dm_not_in_space`). The old answer must stay exactly as it was.
 */

type Row = { userId: string; inSpace: boolean; online: boolean };

async function peopleOf(url: string): Promise<Map<string, Row>> {
  const res = await call(directoryRoute.GET, { url });
  expect(res.status).toBe(200);
  const rows = (res.json?.["people"] ?? []) as Row[];
  return new Map(rows.map((r) => [r.userId, r]));
}

describe("الدردشة السريعة: كل الشركة، وكل واحد معلَّم إذا بمساحتك", () => {
  it("?scope=company lists every space's people, the viewer out and the guests out", async () => {
    const team = await makeTeam();
    // the member's space: the owner is in every space, the admin was never put in this one
    await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    await loginAs(team.member.id);

    const people = await peopleOf("http://localhost/api/chat/directory?scope=company");
    expect(people.has(team.member.id)).toBe(false);
    expect(people.has(team.guest.id)).toBe(false);

    // the owner counts as a person of the space without a row of their own
    expect(people.get(team.owner.id)?.inSpace).toBe(true);
    // the admin is a colleague of the company, but not of this space: listed, marked, no dead button
    expect(people.get(team.admin.id)?.inSpace).toBe(false);
    expect(people.get(team.admin.id)?.online).toBe(false);
  });

  it("without the scope the chat's picker answers exactly what it answered before: the space's people", async () => {
    const team = await makeTeam();
    await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    await loginAs(team.member.id);

    const people = await peopleOf("http://localhost/api/chat/directory");
    expect([...people.keys()]).toEqual([team.owner.id]);
    // the old shape carries no new field, so an older client reads it unchanged
    expect(people.get(team.owner.id)).not.toHaveProperty("inSpace");
  });

  it("a guest is refused the list altogether, as before", async () => {
    const team = await makeTeam();
    await loginAs(team.guest.id);
    const res = await call(directoryRoute.GET, { url: "http://localhost/api/chat/directory?scope=company" });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("chat.guest_forbidden");
  });
});

describe("الدردشة السريعة تحترم «إخفاء المالك من متصل» (the owner, 2026-10-30)", () => {
  it("switched on, the owner at his screen is listed as not online to the others; off, as before", async () => {
    const { db } = await import("./helpers");
    const { withFeature } = await import("@/lib/features");
    const { resetPresenceForTests, touchPresence } = await import("@/server/realtime/presence");
    resetPresenceForTests();
    const team = await makeTeam();
    await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    touchPresence(team.owner.id);
    await loginAs(team.member.id);
    expect((await peopleOf("http://localhost/api/chat/directory?scope=company")).get(team.owner.id)?.online).toBe(true);

    const org = await db.organization.findUniqueOrThrow({ where: { id: team.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: team.org.id }, data: { settings: withFeature(org.settings, "ownerHiddenOnline", true) as never } });
    expect((await peopleOf("http://localhost/api/chat/directory?scope=company")).get(team.owner.id)?.online).toBe(false);
  });
});
