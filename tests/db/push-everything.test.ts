import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as featuresRoute from "@/app/api/settings/features/route";
import { setPushSenderForTests, type PushMessage } from "@/server/calls/push";
import { flushPushesForTests, pushNotification, pushNotificationToMany } from "@/server/notify";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * «إشعارات على التلفون واللابتوب» (the owner's first feature after the research, 2026-10-26): every notification of
 * the bell also goes out as a Web Push to the browsers its person allowed, through the calls' ringing base. The switch
 * `pushEverything` in «الميزات» turns it off; a ring still goes out then, as before.
 */
const sent: { endpoint: string; message: PushMessage }[] = [];
beforeEach(() => {
  sent.length = 0;
  setPushSenderForTests(async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload) as PushMessage });
    return { statusCode: 201 };
  });
});
afterAll(() => setPushSenderForTests(null));

const endpointOf = (who: string) => `https://push.test.local/${who}-${Math.random().toString(36).slice(2)}`;
async function allow(userId: string) {
  const endpoint = endpointOf(userId);
  await db.pushSubscription.create({ data: { userId, endpoint, p256dh: "p256dh-key", auth: "auth-key" } });
  return endpoint;
}

describe("a notification reaches the person's devices", () => {
  it("one notification: one push per allowed browser, opening its page in its space", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }]);
    const phone = await allow(t.member.id);
    const laptop = await allow(t.member.id);
    await pushNotification({ userId: t.member.id, type: "task_assigned", title: "مهمة جديدة", body: "ZAK-12 اطبع الفلايرات", linkUrl: "/tasks/abc", workspaceId: ws.id });
    await flushPushesForTests();
    expect(sent.map((s) => s.endpoint).sort()).toEqual([phone, laptop].sort());
    const msg = sent[0]!.message;
    expect(msg).toMatchObject({ kind: "note", title: "مهمة جديدة", body: "ZAK-12 اطبع الفلايرات" });
    expect(msg.url).toBe(`/go?space=${ws.id}&next=%2Ftasks%2Fabc`);
    // the bell has it too
    expect(await db.notification.count({ where: { userId: t.member.id } })).toBe(1);
  });

  it("many people at once; a person who allowed nothing gets only the bell", async () => {
    const t = await makeTeam();
    const adminPhone = await allow(t.admin.id);
    await pushNotificationToMany([t.admin.id, t.member.id], { type: "ticket_created", title: "تذكرة جديدة", linkUrl: "/tickets" });
    await flushPushesForTests();
    expect(sent.map((s) => s.endpoint)).toEqual([adminPhone]);
    expect(sent[0]!.message.url).toBe("/tickets");
    expect(await db.notification.count({ where: { userId: t.member.id } })).toBe(1);
  });

  it("switched off in «الميزات»: the bell only, no push; on again: the push is back", async () => {
    const t = await makeTeam();
    await allow(t.member.id);
    await loginAs(t.owner.id);
    expect((await call(featuresRoute.PATCH, { method: "PATCH", body: { key: "pushEverything", on: false } })).status).toBe(200);
    await pushNotification({ userId: t.member.id, type: "task_assigned", title: "Off" });
    await flushPushesForTests();
    expect(sent).toEqual([]);
    expect(await db.notification.count({ where: { userId: t.member.id } })).toBe(1);

    await call(featuresRoute.PATCH, { method: "PATCH", body: { key: "pushEverything", on: true } });
    await pushNotification({ userId: t.member.id, type: "task_assigned", title: "On" });
    await flushPushesForTests();
    expect(sent.map((s) => s.message.title)).toEqual(["On"]);
  });

  it("a suspended person gets neither", async () => {
    const t = await makeTeam();
    await allow(t.member.id);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: t.org.id, userId: t.member.id } },
      data: { status: "SUSPENDED" },
    });
    await pushNotification({ userId: t.member.id, type: "task_assigned", title: "Nobody" });
    await flushPushesForTests();
    expect(sent).toEqual([]);
  });
});
