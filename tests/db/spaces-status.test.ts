import { describe, expect, it } from "vitest";
import * as spaceRoute from "@/app/api/workspaces/[id]/route";
import * as membersRoute from "@/app/api/workspaces/[id]/members/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { call, db, loginAs, uid } from "./helpers";
import { giveSecondHome, makePerson, makeSpaceWorld, rowsOf, setStatus } from "./spaces-helpers";

/**
 * A person who is suspended or offboarded loses access to every space at once. Their rows may stay
 * (history, and reactivation restores everything), but nothing opens for them: no list, no read, no
 * write, on any of the space routes.
 */

/** Member (MEMBER row), lead (space ADMIN row), guest (GUEST row): the lead is the one who gets suspended. */
const world = () => makeSpaceWorld({ member: "MEMBER", lead: "ADMIN", guest: "GUEST" });
type World = Awaited<ReturnType<typeof world>>;

/** Every space route, called for `w.ws`, as [label, status, message]. Each one would succeed for a space ADMIN. */
async function everyRoute(w: World, extra: { orgId?: string } = {}) {
  const colleague = await makePerson(w, `Colleague ${uid()}`);
  const calls: [string, Awaited<ReturnType<typeof call>>][] = [
    ["list spaces", await call(workspacesRoute.GET)],
    ["create a space", await call(workspacesRoute.POST, { body: { name: `Created ${uid()}`, ...(extra.orgId ? { organizationId: extra.orgId } : {}) } })],
    ["read the space", await call(spaceRoute.GET, { params: { id: w.ws.id } })],
    ["rename the space", await call(spaceRoute.PATCH, { method: "PATCH", params: { id: w.ws.id }, body: { name: "Renamed while suspended" } })],
    ["delete the space", await call(spaceRoute.DELETE, { method: "DELETE", params: { id: w.ws.id } })],
    ["list the people", await call(membersRoute.GET, { params: { id: w.ws.id } })],
    ["add a person", await call(membersRoute.POST, { params: { id: w.ws.id }, body: { addUserIds: [colleague.id] } })],
    ["promote a person", await call(membersRoute.PATCH, { method: "PATCH", params: { id: w.ws.id }, body: { userId: w.member.id, role: "ADMIN" } })],
    [
      "remove a person",
      await call(membersRoute.DELETE, {
        method: "DELETE",
        params: { id: w.ws.id },
        url: `http://localhost/api/workspaces/${w.ws.id}/members?userId=${w.member.id}`,
      }),
    ],
  ];
  return { colleague, calls };
}

async function expectNothingChanged(w: World, before: Awaited<ReturnType<typeof rowsOf>>, spaces: number, colleagueId: string) {
  expect((await db.workspace.findUniqueOrThrow({ where: { id: w.ws.id } })).name).toBe(w.ws.name);
  expect(await rowsOf(w.ws.id)).toEqual(before);
  expect(await db.workspace.count({ where: { organizationId: w.org.id } })).toBe(spaces);
  expect(await db.workspaceMember.count({ where: { userId: colleagueId } })).toBe(0);
}

describe.each(["SUSPENDED", "OFFBOARDED"] as const)("a %s person", (status) => {
  it("is signed out at once on every space route (401) while their rows stay; nothing they tried changed anything", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    expect((await call(spaceRoute.GET, { params: { id: w.ws.id } })).status).toBe(200); // before: they are a space ADMIN
    const rows = await rowsOf(w.ws.id);

    await setStatus(w.org.id, w.lead.id, status);
    const { colleague, calls } = await everyRoute(w);
    for (const [label, res] of calls) expect(res.status, `${status}: ${label}`).toBe(401);
    expect(await rowsOf(w.ws.id)).toEqual(rows); // their own ADMIN row is still there: history and reactivation need it
    await expectNothingChanged(w, rows, 1, colleague.id);
  });

  it("is signed out even if only their status moved (the session version was not touched)", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    await setStatus(w.org.id, w.lead.id, status, { endSessions: false });
    for (const [label, res] of (await everyRoute(w)).calls) expect(res.status, `${status}: ${label}`).toBe(401);
  });

  it("is refused by the space guard itself (403) when their session is still honoured because they are ACTIVE in another organization", async () => {
    const w = await world();
    const second = await giveSecondHome(w.lead.id, "MEMBER");
    await loginAs(w.lead.id);
    const rows = await rowsOf(w.ws.id);
    await setStatus(w.org.id, w.lead.id, status, { endSessions: false });

    const { colleague, calls } = await everyRoute(w, { orgId: w.org.id });
    const byLabel = Object.fromEntries(calls.map(([label, res]) => [label, res]));
    // the routes of the space they were in: refused as a non-member, with the usual message
    for (const label of ["read the space", "rename the space", "delete the space", "list the people", "add a person", "promote a person", "remove a person"]) {
      expect(byLabel[label]!.status, `${status}: ${label}`).toBe(403);
      expect(byLabel[label]!.json?.["message"], `${status}: ${label}`).toBe("not_workspace_member");
    }
    // creating a space in the organization they no longer belong to is refused too
    expect(byLabel["create a space"]!.status).toBe(403);
    expect(byLabel["create a space"]!.json?.["message"]).toBe("spaces.wrong_org");
    // the switcher simply does not show that organization any more
    const listing = byLabel["list spaces"]!.json as { organizations: { id: string }[] };
    expect(listing.organizations.map((o) => o.id)).toEqual([second.id]);
    await expectNothingChanged(w, rows, 1, colleague.id);
  });

  it("gets everything back when reactivated: the rows were never removed", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    await setStatus(w.org.id, w.lead.id, status);
    expect((await call(spaceRoute.GET, { params: { id: w.ws.id } })).status).toBe(401);

    await setStatus(w.org.id, w.lead.id, "ACTIVE", { endSessions: false });
    await loginAs(w.lead.id); // a new sign-in with the current session version
    const read = await call(spaceRoute.GET, { params: { id: w.ws.id } });
    expect(read.status).toBe(200);
    expect(read.json?.["canManage"]).toBe(true); // still the space ADMIN
    expect((await call(spaceRoute.PATCH, { method: "PATCH", params: { id: w.ws.id }, body: { name: "Back at work" } })).status).toBe(200);
  });

  it("never appears on the people list of the space, and cannot be added again until reactivated", async () => {
    const w = await world();
    await setStatus(w.org.id, w.lead.id, status);
    await loginAs(w.member.id);
    const res = await call(membersRoute.GET, { params: { id: w.ws.id } });
    expect((res.json?.["members"] as { name: string }[]).map((m) => m.name)).not.toContain("Lead");

    await loginAs(w.owner.id);
    const add = await call(membersRoute.POST, { params: { id: w.ws.id }, body: { addUserIds: [w.lead.id] } });
    // they already have a row, but they are not ACTIVE: refused whether the row exists or not
    expect(add.status).toBe(403);
    expect(add.json?.["message"]).toBe("spaces.member_not_in_org");
  });
});

describe("a suspended or offboarded OWNER is not the owner any more", () => {
  it.each(["SUSPENDED", "OFFBOARDED"] as const)("%s: the guard does not let them into a space they have no row in", async (status) => {
    const w = await world();
    await giveSecondHome(w.owner.id, "MEMBER");
    await loginAs(w.owner.id);
    expect((await call(spaceRoute.GET, { params: { id: w.ws.id } })).status).toBe(200);
    await setStatus(w.org.id, w.owner.id, status, { endSessions: false });
    const res = await call(spaceRoute.GET, { params: { id: w.ws.id } });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("not_workspace_member");
    expect((await call(membersRoute.GET, { params: { id: w.ws.id } })).status).toBe(403);
  });
});
