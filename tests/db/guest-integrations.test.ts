import { afterEach, describe, expect, it, vi } from "vitest";
import * as telegramRoute from "@/app/api/integrations/telegram/route";
import * as telegramMessagesRoute from "@/app/api/integrations/telegram/messages/route";
import * as telegramSendRoute from "@/app/api/integrations/telegram/send/route";
import * as telegramSyncRoute from "@/app/api/integrations/telegram/sync/route";
import * as n8nRoute from "@/app/api/integrations/n8n/route";
import { call, db, loginAs, logout, makeTeam } from "./helpers";
import { CUSTOMER_CHAT_TITLE, CUSTOMER_PHONE, N8N_HOOK, seedN8n, seedTelegram } from "./guest-helpers";

const BASE = "http://localhost/api/integrations/telegram";
const VALID_TOKEN = "123456789:AAfake_bot_token_for_the_tests_0123456789abc";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Nothing here may reach the real Telegram; a test can then prove no call was made. */
function stubNetwork() {
  const fn = vi.fn(async () => new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("Telegram: closed to a GUEST", () => {
  it("refuses the chat list and every message thread, and no customer data is in the answer", async () => {
    const t = await makeTeam();
    const { chatId } = await seedTelegram(t.org.id);
    await loginAs(t.guest.id);

    const list = await call(telegramRoute.GET);
    const thread = await call(telegramMessagesRoute.GET, { url: `${BASE}/messages?chatId=${chatId}` });
    for (const res of [list, thread]) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("guest.no_access");
      expect(res.text).not.toContain(CUSTOMER_PHONE);
      expect(res.text).not.toContain(CUSTOMER_CHAT_TITLE);
    }
  });

  it("refuses connect, disconnect, send and sync - nothing is sent and nothing changes", async () => {
    const t = await makeTeam();
    const { chatId, integration } = await seedTelegram(t.org.id);
    const network = stubNetwork();
    await loginAs(t.guest.id);

    const attempts = [
      await call(telegramRoute.POST, { url: BASE, body: { token: VALID_TOKEN } }),
      await call(telegramRoute.DELETE, { url: BASE, method: "DELETE" }),
      await call(telegramSendRoute.POST, { url: `${BASE}/send`, body: { chatId, text: "psst" } }),
      await call(telegramSyncRoute.POST, { url: `${BASE}/sync`, method: "POST" }),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("guest.no_access");
    }
    expect(network).not.toHaveBeenCalled();

    const row = await db.integration.findUniqueOrThrow({ where: { id: integration.id } });
    expect(row.connected).toBe(true);
    expect(await db.telegramMessage.count({ where: { integrationId: integration.id } })).toBe(1);
  });

  it("an anonymous caller still gets 401", async () => {
    logout();
    expect((await call(telegramRoute.GET)).status).toBe(401);
  });
});

describe("Telegram: everyone else keeps what they had", () => {
  for (const role of ["member", "admin", "owner"] as const) {
    it(`${role.toUpperCase()} reads the chat list and the message thread`, async () => {
      const t = await makeTeam();
      const { chatId } = await seedTelegram(t.org.id);
      await loginAs(t[role].id);

      const list = await call(telegramRoute.GET);
      expect(list.status).toBe(200);
      expect(list.json?.["botUsername"]).toBe("zaki_test_bot");
      expect(list.text).toContain(CUSTOMER_CHAT_TITLE);

      const thread = await call(telegramMessagesRoute.GET, { url: `${BASE}/messages?chatId=${chatId}` });
      expect(thread.status).toBe(200);
      expect(thread.text).toContain(CUSTOMER_PHONE);
    });
  }

  it("a plain MEMBER still cannot connect or disconnect the bot", async () => {
    const t = await makeTeam();
    const { integration } = await seedTelegram(t.org.id);
    const network = stubNetwork();
    await loginAs(t.member.id);
    expect((await call(telegramRoute.POST, { url: BASE, body: { token: VALID_TOKEN } })).status).toBe(403);
    expect((await call(telegramRoute.DELETE, { url: BASE, method: "DELETE" })).status).toBe(403);
    expect(network).not.toHaveBeenCalled();
    expect((await db.integration.findUniqueOrThrow({ where: { id: integration.id } })).connected).toBe(true);
  });
});

describe("n8n status: who sees the webhook URL", () => {
  it("a GUEST gets 403 and none of it", async () => {
    const t = await makeTeam();
    await seedN8n(t.org.id);
    await loginAs(t.guest.id);
    const res = await call(n8nRoute.GET);
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("guest.no_access");
    expect(res.text).not.toContain("s3cr3t-path");
    expect(res.text).not.toContain("task.created");
  });

  it("a plain MEMBER learns whether n8n is connected, but not the webhook URL or the event filter", async () => {
    const t = await makeTeam();
    await seedN8n(t.org.id);
    await db.integrationEvent.create({ data: { orgId: t.org.id, direction: "OUT", type: "n8n.test", status: "OK" } });
    await loginAs(t.member.id);

    const res = await call(n8nRoute.GET);
    expect(res.status).toBe(200);
    expect(res.json?.["status"]).toEqual({ connected: true, webhookUrl: null, events: [], sharedSecret: null });
    expect(res.text).not.toContain("s3cr3t-path");
    expect(res.text).not.toContain("hooks.example.com");
    // the event log under the status stays readable
    expect((res.json?.["events"] as { type: string }[]).map((e) => e.type)).toContain("n8n.test");
  });

  it("an OWNER and an ADMIN get the whole status, as before", async () => {
    const t = await makeTeam();
    await seedN8n(t.org.id);
    for (const user of [t.owner, t.admin]) {
      await loginAs(user.id);
      const res = await call(n8nRoute.GET);
      expect(res.status).toBe(200);
      expect(res.json?.["status"]).toMatchObject({
        connected: true,
        webhookUrl: N8N_HOOK,
        events: ["task.created", "task.moved"],
      });
    }
  });

  it("an organization with no n8n connection answers 'not connected' to everyone allowed in", async () => {
    const t = await makeTeam();
    for (const user of [t.member, t.admin]) {
      await loginAs(user.id);
      const res = await call(n8nRoute.GET);
      expect(res.status).toBe(200);
      expect(res.json?.["status"]).toEqual({ connected: false, webhookUrl: null, events: [], sharedSecret: null });
    }
  });
});
