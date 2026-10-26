import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as convCallRoute from "@/app/api/chat/conversations/[id]/call/route";
import * as tokenRoute from "@/app/api/calls/[id]/token/route";
import * as endRoute from "@/app/api/calls/[id]/end/route";
import * as inviteRoute from "@/app/api/calls/[id]/invite/route";
import * as subscribeRoute from "@/app/api/push/subscribe/route";
import * as keyRoute from "@/app/api/push/key/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import { setCallsFetchForTests } from "@/server/calls/livekit";
import { setPushSenderForTests, type PushMessage } from "@/server/calls/push";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const saved: Record<string, string | undefined> = {};
const sent: { endpoint: string; message: PushMessage }[] = [];
let gone = new Set<string>();

beforeAll(() => {
  for (const k of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) saved[k] = process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setCallsFetchForTests(null);
  setPushSenderForTests(null);
});
beforeEach(() => {
  process.env["LIVEKIT_URL"] = "wss://calls.test.local";
  process.env["LIVEKIT_API_KEY"] = "test-key";
  process.env["LIVEKIT_API_SECRET"] = "test-calls-secret-0123456789abcdef0123456789";
  sent.length = 0;
  gone = new Set();
  setCallsFetchForTests(async (input) => (String(input).endsWith("/ListParticipants") ? new Response("{}", { status: 404 }) : Response.json({})));
  setPushSenderForTests(async (sub, payload) => {
    if (gone.has(sub.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload) as PushMessage });
    return { statusCode: 201 };
  });
});

const endpointOf = (who: string) => `https://push.test.local/${who}`;

async function subscribeAs(userId: string, who: string) {
  await loginAs(userId);
  const res = await call(subscribeRoute.POST, { body: { endpoint: endpointOf(who), keys: { p256dh: "BPkey", auth: "authkey" } } });
  expect(res.status).toBe(200);
}

async function world() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }]);
  return { ...t, ws };
}

/** Lets the push that runs after the answer finish. */
const settle = () => new Promise((r) => setTimeout(r, 300));

describe("ringing a closed site (Web Push)", () => {
  it("hands out the server's public key to signed-in people", async () => {
    const t = await world();
    await loginAs(t.member.id);
    const res = await call(keyRoute.GET);
    expect(Buffer.from(res.json?.["publicKey"] as string, "base64url")).toHaveLength(65);
  });

  it("a DM call rings the other person's subscribed phone: «فلان عم يرنّ عليك», opening the call", async () => {
    const t = await world();
    await subscribeAs(t.admin.id, "admin-phone");
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const id = (await call(convCallRoute.POST, { params: { id: dm }, body: { video: true } })).json?.["id"] as string;
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ endpoint: endpointOf("admin-phone"), message: { kind: "ring", url: `/calls/${id}`, tag: `call-${id}` } });
    expect(sent[0]?.message.title).toContain(t.member.name);
  });

  it("«ضيف حدا» rings the person's phone too; nobody who was not rung gets anything", async () => {
    const t = await world();
    const extra = await makeUser({ orgId: t.org.id, role: "MEMBER" });
    await db.workspaceMember.create({ data: { workspaceId: t.ws.id, userId: extra.id } });
    await subscribeAs(extra.id, "extra-phone");
    await subscribeAs(t.owner.id, "owner-phone");
    const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: t.ws.id, title: "General", restricted: true, members: { create: [{ userId: t.member.id }] } } });
    await loginAs(t.member.id);
    const id = (await call(convCallRoute.POST, { params: { id: topic.id }, body: {} })).json?.["id"] as string;
    await settle();
    expect(sent).toHaveLength(0); // the restricted topic's only person is the caller; the owner's silent eye never rings
    await call(inviteRoute.POST, { params: { id }, body: { userId: extra.id } });
    await settle();
    expect(sent.map((s) => s.endpoint)).toEqual([endpointOf("extra-phone")]);
  });

  it("a browser the push service no longer knows is forgotten", async () => {
    const t = await world();
    await subscribeAs(t.admin.id, "old-phone");
    gone.add(endpointOf("old-phone"));
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    await call(convCallRoute.POST, { params: { id: dm }, body: {} });
    await settle();
    expect(await db.pushSubscription.count({ where: { endpoint: endpointOf("old-phone") } })).toBe(0);
  });
});

describe("the missed call", () => {
  it("a DM call the other person never answered ends as «مكالمة فايتة», and their phone says so", async () => {
    const t = await world();
    await subscribeAs(t.admin.id, "admin-phone");
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const id = (await call(convCallRoute.POST, { params: { id: dm }, body: {} })).json?.["id"] as string;
    await call(tokenRoute.POST, { method: "POST", params: { id } }); // the caller is in
    await call(endRoute.POST, { method: "POST", params: { id } }); // and hangs up: nobody answered
    await settle();
    const lines = await db.chatMessage.findMany({ where: { conversationId: dm, kind: "SYSTEM" }, orderBy: { createdAt: "asc" } });
    expect(lines.map((l) => (JSON.parse(l.body) as { k: string }).k)).toEqual(["call_started", "call_missed"]);
    expect(sent.map((s) => s.message.kind)).toEqual(["ring", "missed"]);
    expect(sent[1]?.message.url).toBe(`/chat/${dm}`);
  });

  it("a DM call the other person answered ends as «خلصت المكالمة»", async () => {
    const t = await world();
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const id = (await call(convCallRoute.POST, { params: { id: dm }, body: {} })).json?.["id"] as string;
    await loginAs(t.admin.id);
    await call(tokenRoute.POST, { method: "POST", params: { id } }); // answered
    await loginAs(t.member.id);
    await call(endRoute.POST, { method: "POST", params: { id } });
    const lines = await db.chatMessage.findMany({ where: { conversationId: dm, kind: "SYSTEM" }, orderBy: { createdAt: "asc" } });
    expect(lines.map((l) => (JSON.parse(l.body) as { k: string }).k)).toEqual(["call_started", "call_ended"]);
  });
});
