import { describe, expect, it } from "vitest";
import * as conversationsRoute from "@/app/api/chat/conversations/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as conversationMessagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as joinRoute from "@/app/api/chat/conversations/[id]/join/route";
import * as readRoute from "@/app/api/chat/conversations/[id]/read/route";
import * as deliveredRoute from "@/app/api/chat/conversations/[id]/delivered/route";
import * as oversightRoute from "@/app/api/chat/oversight/conversations/[id]/route";
import { canModerate, canPin, canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

const DM_SECRET = "DM secret: the supplier's price is 41";
const TOPIC_SECRET = "Topic secret: the launch moves to Monday";
const HQ_SECRET = "HQ secret: salaries are paid on the 3rd";

/**
 * Company A has a DM, a space topic and an HQ-style topic (its id is built from the org id,
 * like `hq.ts` builds it), each with a message. Company B is a second company on the same
 * server, whose OWNER registered on their own.
 */
async function twoCompanies() {
  const a = await makeTeam();
  const b = await makeTeam();

  await loginAs(a.member.id);
  const dm = await call(conversationsRoute.POST, { body: { kind: "DM", userId: a.admin.id } });
  expect(dm.status).toBe(201);
  const dmId = dm.json?.["id"] as string;
  expect((await call(conversationMessagesRoute.POST, { params: { id: dmId }, body: { body: DM_SECRET } })).status).toBe(201);

  const space = await makeWorkspace(a.org.id, [{ userId: a.member.id }, { userId: a.admin.id, role: "ADMIN" }]);
  const topic = await db.conversation.create({ data: { orgId: a.org.id, kind: "TOPIC", spaceId: space.id, title: "General" } });
  expect((await call(conversationMessagesRoute.POST, { params: { id: topic.id }, body: { body: TOPIC_SECRET } })).status).toBe(201);

  const hq = await db.conversation.create({
    data: { id: `cv_hq_general_${a.org.id}`, orgId: a.org.id, kind: "TOPIC", spaceId: space.id, title: "عام" },
  });
  expect((await call(conversationMessagesRoute.POST, { params: { id: hq.id }, body: { body: HQ_SECRET } })).status).toBe(201);

  return { a, b, ids: { dm: dmId, topic: topic.id, hq: hq.id } };
}

function expectNothingLeaks(res: { status: number; text: string }) {
  expect(res.status).not.toBe(200);
  expect(res.text).not.toContain(DM_SECRET);
  expect(res.text).not.toContain(TOPIC_SECRET);
  expect(res.text).not.toContain(HQ_SECRET);
}

describe("chat: one company never reads another company's conversations", () => {
  it("the OWNER of company B gets 404 on every conversation of company A, by id", async () => {
    const { b, ids } = await twoCompanies();
    await loginAs(b.owner.id);
    for (const id of [ids.dm, ids.topic, ids.hq]) {
      const res = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } });
      expect(res.status).toBe(404);
      expectNothingLeaks(res);
    }
  });

  it("nor through the owner's oversight read, joining, the read and delivered marks or posting", async () => {
    const { b, ids } = await twoCompanies();
    await loginAs(b.owner.id);
    for (const id of [ids.dm, ids.topic, ids.hq]) {
      const url = `http://localhost/api/chat/conversations/${id}`;
      expectNothingLeaks(await call(oversightRoute.GET, { params: { id } }));
      expectNothingLeaks(await call(conversationRoute.POST, { url, params: { id } }));
      expectNothingLeaks(await call(joinRoute.POST, { url, params: { id } }));
      expectNothingLeaks(await call(readRoute.POST, { url, params: { id } }));
      expectNothingLeaks(await call(deliveredRoute.POST, { url, params: { id } }));
      const posted = await call(conversationMessagesRoute.POST, { params: { id }, body: { body: "hello from company B" } });
      expect(posted.status).not.toBe(201);
    }
    expect(await db.chatMessage.count({ where: { body: "hello from company B" } })).toBe(0);
    expect(await db.conversationMember.count({ where: { userId: b.owner.id } })).toBe(0);
  });

  it("no rank of company B counts in company A: member and admin of B are refused too", async () => {
    const { b, ids } = await twoCompanies();
    for (const who of [b.admin, b.member]) {
      await loginAs(who.id);
      const res = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${ids.topic}`, params: { id: ids.topic } });
      expect(res.status).toBe(404);
      expectNothingLeaks(res);
    }
  });

  it("the policy itself refuses facts of one org paired with a rank held in another", async () => {
    const { a, b, ids } = await twoCompanies();
    const facts = await loadConversationFacts(b.owner.id, ids.topic);
    const ownerAtHome = await loadOrgFacts(b.owner.id, b.org.id);
    expect(facts?.orgId).toBe(a.org.id);
    expect(ownerAtHome?.role).toBe("OWNER");
    expect(canRead(facts, ownerAtHome)).toBe(false);
    expect(canModerate(facts, ownerAtHome)).toBe(false);
    expect(canPin(facts, ownerAtHome)).toBe(false);
  });

  it("company A's own owner and people still read their conversations (the fix closes only the foreign door)", async () => {
    const { a, ids } = await twoCompanies();
    await loginAs(a.owner.id);
    const asOwner = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${ids.topic}`, params: { id: ids.topic } });
    expect(asOwner.status).toBe(200);
    expect(asOwner.text).toContain(TOPIC_SECRET);

    await loginAs(a.admin.id);
    const asPeer = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${ids.dm}`, params: { id: ids.dm } });
    expect(asPeer.status).toBe(200);
    expect(asPeer.text).toContain(DM_SECRET);
  });
});
