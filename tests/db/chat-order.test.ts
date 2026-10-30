import { afterAll, describe, expect, it } from "vitest";
import * as orderRoute from "@/app/api/chat/order/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import { chatHome } from "@/server/chat/home";
import { saveOrder } from "@/server/chat/order";
import { dmKeyOf } from "@/server/chat/dm";
import { call, db, loginAs, logout, makeOrg, makeTeam, makeUser, makeWorkspace } from "./helpers";

afterAll(async () => { await db.$disconnect(); });

const URL_ORDER = "http://localhost/api/chat/order";
const ctxOf = (orgId: string, userId: string, orgRole: "OWNER" | "ADMIN" | "MEMBER" | "GUEST" = "MEMBER") => ({ orgId, userId, orgRole });

/** A space with `n` open topics in a fixed default order (t0, t1, ...). */
async function spaceWithTopics(orgId: string, people: { userId: string; role?: "ADMIN" | "MEMBER" | "GUEST" }[], n = 4) {
  const ws = await makeWorkspace(orgId, people);
  const topics: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: ws.id, title: `t${i}`, position: i } });
    topics.push(c.id);
  }
  return { ws, topics };
}

const topicIds = async (orgId: string, userId: string, spaceId: string, role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST" = "MEMBER") => {
  const home = await chatHome(ctxOf(orgId, userId, role), { spaceId });
  return home.spaces.find((s) => s.id === spaceId)!.topics.map((t) => t.id);
};

describe("a person's own chat order", () => {
  it("is returned by the home in the saved order, and never reaches anybody else", async () => {
    const t = await makeTeam();
    const { ws, topics } = await spaceWithTopics(t.org.id, [{ userId: t.owner.id }, { userId: t.member.id }, { userId: t.admin.id }]);
    const [t0, t1, t2, t3] = topics as [string, string, string, string];
    await loginAs(t.member.id);
    const put = await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: `space:${ws.id}`, order: [t3, t1, t0, t2] } });
    expect(put.status).toBe(200);
    expect(await topicIds(t.org.id, t.member.id, ws.id)).toEqual([t3, t1, t0, t2]);
    // the colleagues see the space's own order, untouched
    expect(await topicIds(t.org.id, t.admin.id, ws.id, "ADMIN")).toEqual([t0, t1, t2, t3]);
    expect(await topicIds(t.org.id, t.owner.id, ws.id, "OWNER")).toEqual([t0, t1, t2, t3]);
    await loginAs(t.admin.id);
    expect((await call(orderRoute.GET, { url: URL_ORDER })).json).toEqual({ orders: {} });
    // and the position the moderators gave the topics did not move
    const rows = await db.conversation.findMany({ where: { spaceId: ws.id }, orderBy: { position: "asc" }, select: { id: true } });
    expect(rows.map((r) => r.id)).toEqual([t0, t1, t2, t3]);
    // the home tells the screen that this scope has an order of its own
    const home = await chatHome(ctxOf(t.org.id, t.member.id), { spaceId: ws.id });
    expect(home.ordered).toEqual([`space:${ws.id}`]);
  });

  it("keeps the moderator's pinned topics first: the order applies inside the pinned group and inside the unpinned one", async () => {
    const t = await makeTeam();
    const { ws, topics } = await spaceWithTopics(t.org.id, [{ userId: t.member.id }], 5);
    const [t0, t1, t2, t3, t4] = topics as [string, string, string, string, string];
    await db.conversation.update({ where: { id: t1 }, data: { pinnedAt: new Date(Date.now() - 2000) } });
    await db.conversation.update({ where: { id: t3 }, data: { pinnedAt: new Date(Date.now() - 1000) } });
    // default: the last pinned first (t3, t1), then the space's order (t0, t2, t4)
    expect(await topicIds(t.org.id, t.member.id, ws.id)).toEqual([t3, t1, t0, t2, t4]);
    await saveOrder(ctxOf(t.org.id, t.member.id), `space:${ws.id}`, [t4, t2, t0, t1, t3]);
    // the unpinned ones follow the saved order, the pinned ones theirs, and the pin still floats
    expect(await topicIds(t.org.id, t.member.id, ws.id)).toEqual([t1, t3, t4, t2, t0]);
  });

  it("a topic the saved order does not know falls in at its default place; one that vanished is ignored", async () => {
    const t = await makeTeam();
    const { ws, topics } = await spaceWithTopics(t.org.id, [{ userId: t.member.id }], 3);
    const [t0, t1, t2] = topics as [string, string, string];
    await saveOrder(ctxOf(t.org.id, t.member.id), `space:${ws.id}`, [t2, t1, t0]);
    const fresh = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "new", position: 99 } });
    expect(await topicIds(t.org.id, t.member.id, ws.id)).toEqual([t2, t1, t0, fresh.id]);
    await db.conversation.delete({ where: { id: t1 } });
    expect(await topicIds(t.org.id, t.member.id, ws.id)).toEqual([t2, t0, fresh.id]);
  });

  it("drops, on save, the ids the person may not read: another space, a restricted topic, a foreign company, nonsense", async () => {
    const t = await makeTeam();
    const { ws, topics } = await spaceWithTopics(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id }], 2);
    const other = await spaceWithTopics(t.org.id, [{ userId: t.admin.id }], 1);
    const secret = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "secret", restricted: true, position: 5, members: { create: [{ userId: t.admin.id }] } } });
    const foreignOrg = await makeOrg();
    const foreignUser = await makeUser({ orgId: foreignOrg.id });
    const foreign = await spaceWithTopics(foreignOrg.id, [{ userId: foreignUser.id }], 1);
    const kept = await saveOrder(ctxOf(t.org.id, t.member.id), `space:${ws.id}`, [
      secret.id, other.topics[0]!, foreign.topics[0]!, "not-an-id", topics[1]!, topics[0]!, topics[1]!,
    ]);
    expect(kept).toEqual([topics[1], topics[0]]);
    const row = await db.userChatOrder.findFirstOrThrow({ where: { userId: t.member.id } });
    expect(row.order).toEqual([topics[1], topics[0]]);
    // the restricted topic's id leaked nowhere; the admin, who is in it, may order it
    await saveOrder(ctxOf(t.org.id, t.admin.id, "ADMIN"), `space:${ws.id}`, [secret.id, topics[0]!]);
    expect((await db.userChatOrder.findFirstOrThrow({ where: { userId: t.admin.id } })).order).toEqual([secret.id, topics[0]]);
  });

  it("refuses a space the person is not in, a scope that is not theirs, and gives a guest no private chats", async () => {
    const t = await makeTeam();
    const mine = await spaceWithTopics(t.org.id, [{ userId: t.member.id }, { userId: t.guest.id, role: "GUEST" }], 1);
    const theirs = await spaceWithTopics(t.org.id, [{ userId: t.admin.id }], 1);
    await loginAs(t.member.id);
    expect((await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: `space:${theirs.ws.id}`, order: [theirs.topics[0]!] } })).status).toBe(404);
    expect((await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "space:nope", order: [] } })).status).toBe(404);
    expect((await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "bad scope", order: [] } })).status).toBe(422);
    expect((await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "dm", order: Array.from({ length: 501 }, (_, i) => `c${i}`) } })).status).toBe(422);
    expect(await db.userChatOrder.count({ where: { userId: t.member.id } })).toBe(0);
    await loginAs(t.guest.id);
    expect((await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "dm", order: [] } })).status).toBe(403);
    // a guest orders the topics of the space they are in
    expect((await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: `space:${mine.ws.id}`, order: [mine.topics[0]!] } })).status).toBe(200);
    logout();
    expect((await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: "dm", order: [] } })).status).toBe(401);
    expect((await call(orderRoute.GET, { url: URL_ORDER })).status).toBe(401);
  });

  it("reset puts the original order back", async () => {
    const t = await makeTeam();
    const { ws, topics } = await spaceWithTopics(t.org.id, [{ userId: t.member.id }], 3);
    await loginAs(t.member.id);
    await call(orderRoute.PUT, { method: "PUT", url: URL_ORDER, body: { scope: `space:${ws.id}`, order: [topics[2]!, topics[0]!, topics[1]!] } });
    expect(await topicIds(t.org.id, t.member.id, ws.id)).toEqual([topics[2], topics[0], topics[1]]);
    const res = await call(orderRoute.DELETE, { method: "DELETE", url: `${URL_ORDER}?scope=${encodeURIComponent(`space:${ws.id}`)}` });
    expect(res.status).toBe(200);
    expect(await topicIds(t.org.id, t.member.id, ws.id)).toEqual(topics);
    expect(await db.userChatOrder.count({ where: { userId: t.member.id } })).toBe(0);
    // saving an empty list is a reset too, and a reset with nothing saved is not an error
    await saveOrder(ctxOf(t.org.id, t.member.id), `space:${ws.id}`, [topics[1]!]);
    await saveOrder(ctxOf(t.org.id, t.member.id), `space:${ws.id}`, []);
    expect(await db.userChatOrder.count({ where: { userId: t.member.id } })).toBe(0);
    expect((await call(orderRoute.DELETE, { method: "DELETE", url: `${URL_ORDER}?scope=dm` })).status).toBe(200);
    expect((await call(orderRoute.DELETE, { method: "DELETE", url: URL_ORDER })).status).toBe(422);
  });

  it("orders the private chats, and only the person's own", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id }, { userId: t.owner.id }]);
    const peer = await makeUser({ orgId: t.org.id });
    await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: peer.id } });
    await loginAs(t.member.id);
    const withAdmin = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const withPeer = (await call(dmRoute.POST, { body: { userId: peer.id } })).json?.["id"] as string;
    const adminPeer = await db.conversation.create({ data: { orgId: t.org.id, kind: "DM", dmKey: dmKeyOf(t.admin.id, peer.id, ws.id), spaceId: ws.id, members: { create: [{ userId: t.admin.id }, { userId: peer.id }] } } });
    const dmIds = async (userId: string) => (await chatHome(ctxOf(t.org.id, userId), { spaceId: ws.id })).dms.map((d) => d.id);
    const before = await dmIds(t.member.id);
    const flipped = [...before].reverse();
    // a DM of two other people is dropped, whoever asks
    const kept = await saveOrder(ctxOf(t.org.id, t.member.id), `dm:${ws.id}`, [adminPeer.id, ...flipped]);
    expect(kept).toEqual(flipped);
    expect(await dmIds(t.member.id)).toEqual(flipped);
    expect(await dmIds(t.admin.id)).not.toContain(withPeer);
    expect(new Set(before)).toEqual(new Set([withAdmin, withPeer]));
    // the peer has never ordered anything
    expect(await db.userChatOrder.count({ where: { userId: peer.id } })).toBe(0);
  });

  it("the owner's ordering writes nothing about read state and nothing anybody else sees; his oversight DMs are not his to order", async () => {
    const t = await makeTeam();
    const { ws, topics } = await spaceWithTopics(t.org.id, [{ userId: t.member.id }], 3);
    const dm = await db.conversation.create({ data: { orgId: t.org.id, kind: "DM", dmKey: dmKeyOf(t.member.id, t.admin.id, ws.id), spaceId: ws.id, members: { create: [{ userId: t.member.id }, { userId: t.admin.id }] } } });
    const membersBefore = await db.conversationMember.findMany({ orderBy: { id: "asc" } });
    const ownerCtx = ctxOf(t.org.id, t.owner.id, "OWNER");
    // he orders a space he is in no row of, reading silently
    const kept = await saveOrder(ownerCtx, `space:${ws.id}`, [topics[2]!, topics[1]!, topics[0]!]);
    expect(kept).toEqual([topics[2], topics[1], topics[0]]);
    expect(await topicIds(t.org.id, t.owner.id, ws.id, "OWNER")).toEqual([topics[2], topics[1], topics[0]]);
    expect(await saveOrder(ownerCtx, `dm:${ws.id}`, [dm.id])).toEqual([]);
    // no membership, no read mark, nothing changed for the people of the space
    expect(await db.conversationMember.findMany({ orderBy: { id: "asc" } })).toEqual(membersBefore);
    expect(await db.userChatOrder.count({ where: { orgId: t.org.id, userId: { not: t.owner.id } } })).toBe(0);
    expect(await topicIds(t.org.id, t.member.id, ws.id)).toEqual(topics);
  });

  it("a space the person left is ignored: its saved order neither shows nor is accepted", async () => {
    const t = await makeTeam();
    const { ws, topics } = await spaceWithTopics(t.org.id, [{ userId: t.member.id }], 2);
    const keep = await spaceWithTopics(t.org.id, [{ userId: t.member.id }], 2);
    await saveOrder(ctxOf(t.org.id, t.member.id), `space:${ws.id}`, [topics[1]!, topics[0]!]);
    await saveOrder(ctxOf(t.org.id, t.member.id), `space:${keep.ws.id}`, [keep.topics[1]!, keep.topics[0]!]);
    await db.workspaceMember.deleteMany({ where: { workspaceId: ws.id, userId: t.member.id } });
    const home = await chatHome(ctxOf(t.org.id, t.member.id));
    expect(home.spaces.map((s) => s.id)).toEqual([keep.ws.id]);
    expect(home.spaces[0]!.topics.map((x) => x.id)).toEqual([keep.topics[1], keep.topics[0]]);
    expect(home.ordered).toEqual([`space:${keep.ws.id}`]);
    await expect(saveOrder(ctxOf(t.org.id, t.member.id), `space:${ws.id}`, [topics[0]!])).rejects.toThrow();
    // joining again brings the old order back, it was never lost
    await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: t.member.id } });
    expect(await topicIds(t.org.id, t.member.id, ws.id)).toEqual([topics[1], topics[0]]);
  });

  it("a suspended person is nobody: nothing is saved", async () => {
    const t = await makeTeam();
    const { ws, topics } = await spaceWithTopics(t.org.id, [{ userId: t.member.id }], 2);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: t.org.id, userId: t.member.id } }, data: { status: "SUSPENDED" } });
    await expect(saveOrder(ctxOf(t.org.id, t.member.id), `space:${ws.id}`, [topics[0]!])).rejects.toThrow();
    expect(await db.userChatOrder.count({ where: { userId: t.member.id } })).toBe(0);
  });

  it("keeps one row per person per list, and a list in two companies apart", async () => {
    const t = await makeTeam();
    const { ws, topics } = await spaceWithTopics(t.org.id, [{ userId: t.member.id }], 2);
    await saveOrder(ctxOf(t.org.id, t.member.id), `space:${ws.id}`, [topics[0]!, topics[1]!]);
    await saveOrder(ctxOf(t.org.id, t.member.id), `space:${ws.id}`, [topics[1]!, topics[0]!]);
    expect(await db.userChatOrder.count({ where: { userId: t.member.id } })).toBe(1);
    // the same plain scope («dm») in another company is another row
    const org2 = await makeOrg();
    await db.organizationMember.create({ data: { organizationId: org2.id, userId: t.member.id, role: "MEMBER" } });
    await saveOrder(ctxOf(t.org.id, t.member.id), "dm", []);
    await db.userChatOrder.create({ data: { userId: t.member.id, orgId: org2.id, scope: "dm", order: [] } });
    await db.userChatOrder.create({ data: { userId: t.member.id, orgId: t.org.id, scope: "dm", order: [] } });
    expect(await db.userChatOrder.count({ where: { userId: t.member.id } })).toBe(3);
  });
});
