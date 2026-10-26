import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as convCallRoute from "@/app/api/chat/conversations/[id]/call/route";
import * as meetingsRoute from "@/app/api/calls/route";
import * as watchListRoute from "@/app/api/watch/route";
import { ringAudience } from "@/server/calls/calls";
import { setCallsFetchForTests } from "@/server/calls/livekit";
import { setWatchFetchForTests } from "@/server/watch/title";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * The per-person section grid, batch 4 (the owner's decision, 2026-10-26): the calls («يشوف» = join and be rung,
 * «يضيف ويعدّل» = start and run one) and «نتفرّج سوا» («يشوف» = watch, «يضيف ويعدّل» = start and end one).
 */
async function setBoxes(orgId: string, userId: string, lists: { capabilities?: string[]; revokedCapabilities?: string[] }) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: lists });
}
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) saved[k] = process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setCallsFetchForTests(null);
  setWatchFetchForTests(null);
});
beforeEach(() => {
  process.env["LIVEKIT_URL"] = "wss://calls.test.local";
  process.env["LIVEKIT_API_KEY"] = "test-key";
  process.env["LIVEKIT_API_SECRET"] = "test-calls-secret-0123456789abcdef0123456789";
  setCallsFetchForTests(async () => Response.json({ participants: [] }));
  setWatchFetchForTests(async () => Response.json({ title: "A talk worth watching" }));
});

async function world() {
  const t = await makeTeam();
  const colleague = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Colleague" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: colleague.id }, { userId: t.admin.id, role: "ADMIN" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  return { ...t, colleague, ws, topic };
}

describe("the calls row", () => {
  it("without «يضيف ويعدّل» a member starts no call and no meeting", async () => {
    const w = await world();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["calls.edit"] });
    await loginAs(w.member.id);
    jar().set(SPACE_COOKIE, w.ws.id);
    const res = await call(convCallRoute.POST, { params: { id: w.topic.id }, body: { video: false, ring: true } });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("section.edit_denied");
    expect((await call(meetingsRoute.POST, { body: { title: null, video: true } })).status).toBe(403);
    expect(await db.call.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("by the template a member starts a call; whoever lacks «يشوف» is not rung", async () => {
    const w = await world();
    await setBoxes(w.org.id, w.colleague.id, { revokedCapabilities: ["calls.view"] });
    await loginAs(w.member.id);
    jar().set(SPACE_COOKIE, w.ws.id);
    expect((await call(convCallRoute.POST, { params: { id: w.topic.id }, body: { video: false, ring: false } })).status).toBe(201);
    const rung = await ringAudience(w.topic.id, w.member.id);
    expect(rung).toContain(w.admin.id);
    expect(rung).not.toContain(w.colleague.id);
  });
});

describe("the «نتفرّج سوا» row", () => {
  it("without «يضيف ويعدّل» no session is started; without «يشوف» the list is closed", async () => {
    const w = await world();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["watch.edit"] });
    await loginAs(w.member.id);
    jar().set(SPACE_COOKIE, w.ws.id);
    expect((await call(watchListRoute.GET)).status).toBe(200);
    const started = await call(watchListRoute.POST, { body: { url: "https://youtu.be/dQw4w9WgXcQ", memberIds: [w.colleague.id] } });
    expect(started.status).toBe(403);
    expect(started.json?.["message"]).toBe("section.edit_denied");

    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["watch.view"] });
    const list = await call(watchListRoute.GET);
    expect(list.status).toBe(403);
    expect(list.json?.["message"]).toBe("section.view_denied");
  });
});
