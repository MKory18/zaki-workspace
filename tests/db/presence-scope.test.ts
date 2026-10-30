import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as presenceRoute from "@/app/api/presence/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { withFeature } from "@/lib/features";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { resetPresenceForTests, touchPresence } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «الموجودون» (the owner, 2026-10-30): the people of the space I am in, not the whole company (a space is like a
 * separate site); the OWNER may look at the whole company by choice; and a switch of «الميزات» lets the owner
 * appear as not at his screen to everybody else.
 */
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar!;
const peopleOf = (res: { json: Record<string, unknown> | null }) => ((res.json?.["people"] ?? []) as { userId: string; name: string; online: boolean }[]).map((p) => p.name);

async function world() {
  const t = await makeTeam();
  const inA = await makeUser({ orgId: t.org.id, name: "InSpaceA" });
  const onlyB = await makeUser({ orgId: t.org.id, name: "OnlyInSpaceB" });
  const a = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: inA.id }], "Space A");
  const b = await makeWorkspace(t.org.id, [{ userId: onlyB.id }], "Space B");
  return { ...t, inA, onlyB, a, b };
}

beforeEach(() => resetPresenceForTests());
afterEach(() => jar().delete(SPACE_COOKIE));

describe("GET /api/presence is limited to the space I am in", () => {
  it("a member sees the people of the current space, not somebody who is only in another one", async () => {
    const w = await world();
    jar().set(SPACE_COOKIE, w.a.id);
    await loginAs(w.member.id);
    const names = peopleOf(await call(presenceRoute.GET));
    expect(names).toContain("InSpaceA");
    expect(names).not.toContain("OnlyInSpaceB");
  });

  it("asking for the whole company changes nothing for a member", async () => {
    const w = await world();
    jar().set(SPACE_COOKIE, w.a.id);
    await loginAs(w.member.id);
    const names = peopleOf(await call(presenceRoute.GET, { url: "http://localhost/api/presence?scope=company" }));
    expect(names).not.toContain("OnlyInSpaceB");
  });

  it("the owner sees the current space by default, and the whole company when he asks", async () => {
    const w = await world();
    jar().set(SPACE_COOKIE, w.a.id);
    await loginAs(w.owner.id);
    expect(peopleOf(await call(presenceRoute.GET))).not.toContain("OnlyInSpaceB");
    expect(peopleOf(await call(presenceRoute.GET, { url: "http://localhost/api/presence?scope=company" }))).toContain("OnlyInSpaceB");
  });
});

describe("«إخفاء المالك من متصل»: a switch the owner turns on and off", () => {
  async function switchOwnerHidden(orgId: string, on: boolean) {
    const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
    await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "ownerHiddenOnline", on) as never } });
  }
  const ownerRow = (res: { json: Record<string, unknown> | null }, ownerId: string) =>
    ((res.json?.["people"] ?? []) as { userId: string; online: boolean }[]).find((p) => p.userId === ownerId);

  it("off (the default): the owner at his screen shows as online, as before", async () => {
    const w = await world();
    jar().set(SPACE_COOKIE, w.a.id);
    touchPresence(w.owner.id);
    await loginAs(w.member.id);
    expect(ownerRow(await call(presenceRoute.GET), w.owner.id)?.online).toBe(true);
  });

  it("on: to everybody else the owner shows as not at his screen, and he does not count in the online number", async () => {
    const w = await world();
    jar().set(SPACE_COOKIE, w.a.id);
    await switchOwnerHidden(w.org.id, true);
    touchPresence(w.owner.id);
    touchPresence(w.inA.id);
    await loginAs(w.member.id);
    const res = await call(presenceRoute.GET);
    expect(ownerRow(res, w.owner.id)?.online).toBe(false);
    expect(res.json?.["onlineCount"]).toBe(2); // the member herself and InSpaceA, never the owner
  });

  it("on: the owner still sees himself at his screen", async () => {
    const w = await world();
    jar().set(SPACE_COOKIE, w.a.id);
    await switchOwnerHidden(w.org.id, true);
    await loginAs(w.owner.id);
    expect(ownerRow(await call(presenceRoute.GET), w.owner.id)?.online).toBe(true);
  });

  it("on: the member pills of a conversation do not light the owner either", async () => {
    const w = await world();
    jar().set(SPACE_COOKIE, w.a.id);
    await switchOwnerHidden(w.org.id, true);
    const topic = await db.conversation.create({
      data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.a.id, title: "General", members: { create: [{ userId: w.member.id }, { userId: w.owner.id }] } },
    });
    touchPresence(w.owner.id);
    await loginAs(w.member.id);
    const res = await call(conversationRoute.GET, { params: { id: topic.id } });
    const members = res.json?.["members"] as { id: string; online: boolean }[];
    expect(members.find((m) => m.id === w.owner.id)?.online).toBe(false);
  });
});
