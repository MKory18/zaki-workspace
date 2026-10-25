import { describe, expect, it } from "vitest";
import * as directoryRoute from "@/app/api/chat/directory/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as homeRoute from "@/app/api/chat/home/route";
import * as unreadRoute from "@/app/api/chat/unread/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { ensureHqSpace } from "@/server/chat/hq";
import { canReadConversation } from "@/server/policy/conversation";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { memberDirectory } from "@/server/services/users";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * PEOPLE AND PRIVATE MESSAGES INSIDE A SPACE (the owner's decision, 2026-10-25: people and DMs only among colleagues
 * who share the space; a space is like a separate account). The people picker and the team page list the space's
 * people (and the owner, who is in every space); a DM is opened in the space you are in, with somebody of it, and
 * lives there; the DMs from before spaces had them are «الشركة»'s.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

/** «الشركة» with everybody, space A (alice, bob) and space B (alice, carol). */
async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const person = (name: string) => makeUser({ orgId, role: "MEMBER", name: `${name} ${uid()}` });
  const alice = await person("Alice");
  const bob = await person("Bob");
  const carol = await person("Carol");
  const hq = await ensureHqSpace(orgId, "الشركة");
  await db.workspaceMember.createMany({ data: [alice, bob, carol].map((p) => ({ workspaceId: hq, userId: p.id, role: "MEMBER" as const })) });
  const a = await makeWorkspace(orgId, [{ userId: alice.id }, { userId: bob.id }], `A ${uid()}`);
  const b = await makeWorkspace(orgId, [{ userId: alice.id }, { userId: carol.id }], `B ${uid()}`);
  return { ...team, alice, bob, carol, hq, a, b };
}

type Picker = { people: Array<{ userId: string }> };
const peopleIn = async () => ((await call(directoryRoute.GET)).json as Picker).people.map((p) => p.userId).sort();

describe("the people you meet in a space", () => {
  it("the people picker lists the space's people and the owner, never somebody of another space", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    enter(w.a.id);
    expect(await peopleIn()).toEqual([w.bob.id, w.owner.id].sort());
    enter(w.b.id);
    expect(await peopleIn()).toEqual([w.carol.id, w.owner.id].sort());
    // «الشركة» is everybody's
    enter(w.hq);
    expect(await peopleIn()).toEqual(expect.arrayContaining([w.bob.id, w.carol.id, w.owner.id]));
  });

  it("the team page lists the space's people", async () => {
    const w = await world();
    const ids = async (spaceId: string) =>
      (await memberDirectory(w.alice.id, { orgId: w.org.id, spaceId }))[0]!.members.map((m) => m.userId).sort();
    expect(await ids(w.a.id)).toEqual([w.alice.id, w.bob.id, w.owner.id].sort());
    expect(await ids(w.b.id)).not.toContain(w.bob.id);
  });
});

describe("a private message belongs to the space it was opened in", () => {
  it("only with somebody of the space you are in (403 otherwise); it lives in that space", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    enter(w.a.id);
    const refused = await call(dmRoute.POST, { body: { userId: w.carol.id } });
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("chat.dm_not_in_space");

    const opened = await call(dmRoute.POST, { body: { userId: w.bob.id } });
    expect(opened.status).toBe(201);
    const dm = await db.conversation.findUniqueOrThrow({ where: { id: (opened.json as { id: string }).id }, select: { spaceId: true, dmKey: true } });
    expect(dm.spaceId).toBe(w.a.id);
    expect(dm.dmKey?.endsWith(`@${w.a.id}`)).toBe(true);
    // the pair still reads it (the key's people come before the space)
    expect(await canReadConversation(w.bob.id, (opened.json as { id: string }).id)).toBe(true);
    // opening it again in the same space finds it
    expect((await call(dmRoute.POST, { body: { userId: w.bob.id } })).json?.["id"]).toBe((opened.json as { id: string }).id);
  });

  it("the same two people have one DM per space; the chat lists the space's DMs only", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    enter(w.a.id);
    const inA = (await call(dmRoute.POST, { body: { userId: w.owner.id } })).json as { id: string };
    enter(w.b.id);
    const inB = (await call(dmRoute.POST, { body: { userId: w.owner.id } })).json as { id: string };
    expect(inA.id).not.toBe(inB.id);
    const dmsOf = async () => ((await call(homeRoute.GET)).json as { dms: Array<{ id: string }> }).dms.map((d) => d.id);
    expect(await dmsOf()).toEqual([inB.id]);
    enter(w.a.id);
    expect(await dmsOf()).toEqual([inA.id]);
  });

  it("the DMs from before spaces had them are «الشركة»'s: listed there, and found again when opened there", async () => {
    const w = await world();
    const [x, y] = w.alice.id < w.bob.id ? [w.alice.id, w.bob.id] : [w.bob.id, w.alice.id];
    const old = await db.conversation.create({
      data: { orgId: w.org.id, kind: "DM", dmKey: `${x}|${y}`, members: { create: [{ userId: w.alice.id }, { userId: w.bob.id }] } },
    });
    await loginAs(w.alice.id);
    const dmsOf = async () => ((await call(homeRoute.GET)).json as { dms: Array<{ id: string }> }).dms.map((d) => d.id);
    enter(w.a.id);
    expect(await dmsOf()).not.toContain(old.id);
    enter(w.hq);
    expect(await dmsOf()).toContain(old.id);
    expect((await call(dmRoute.POST, { body: { userId: w.bob.id } })).json?.["id"]).toBe(old.id);
  });

  it("what waits in a DM counts in its own space (and in the space switcher's number for it)", async () => {
    const w = await world();
    await loginAs(w.bob.id);
    enter(w.a.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.alice.id } })).json as { id: string };
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: dm.id, userId: w.alice.id } }, data: { lastReadAt: new Date(Date.now() - 60_000) } });
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: dm.id, authorId: w.bob.id, body: "hi" } });

    await loginAs(w.alice.id);
    enter(w.a.id);
    expect((await call(unreadRoute.GET)).json?.["total"]).toBe(1);
    enter(w.b.id);
    expect((await call(unreadRoute.GET)).json?.["total"]).toBe(0);
    const list = (await call(workspacesRoute.GET)).json as { organizations: Array<{ workspaces: Array<{ id: string; unread: number }> }> };
    const spaces = list.organizations.flatMap((o) => o.workspaces);
    expect(spaces.find((s) => s.id === w.a.id)?.unread).toBe(1);
    expect(spaces.find((s) => s.id === w.b.id)?.unread).toBe(0);
  });
});
