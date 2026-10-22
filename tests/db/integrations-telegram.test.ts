import { afterEach, describe, expect, it, vi } from "vitest";
import * as sendRoute from "@/app/api/integrations/telegram/send/route";
import { call, db, loginAs, makeTeam } from "./helpers";
import { connectTelegramDirect, nowSec, stubFetch } from "./integrations-helpers";

const SEND_URL = "http://localhost/api/integrations/telegram/send";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Telegram's sendMessage answers with the sent message; `null` = an answer that lacks message_id. */
function stubTelegram(ids: Array<number | null>) {
  let i = 0;
  return stubFetch((c) => {
    if (!c.url.endsWith("/sendMessage")) return new Response("unexpected request", { status: 500 });
    const id = ids[Math.min(i, ids.length - 1)];
    i += 1;
    const text = (JSON.parse(c.body) as { text: string }).text;
    const result = id === null ? { date: nowSec() } : { message_id: id, date: nowSec(), chat: { id: 555001 }, text };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

async function send(userId: string, text: string, chatId = "555001") {
  await loginAs(userId);
  return call(sendRoute.POST, { url: SEND_URL, body: { chatId, text } });
}

const copies = (integrationId: string, chatId = "555001") =>
  db.telegramMessage.findMany({ where: { integrationId, chatId }, orderBy: { messageId: "asc" } });

/** Freezes the unix second, the way two sends inside one second see it. */
function freezeSecond() {
  return vi.spyOn(Date, "now").mockReturnValue(Date.now());
}

describe("telegram send: the stored copy of an outgoing message", () => {
  it("two sends to the same chat in the same second both succeed, stored under Telegram's own message ids", async () => {
    const { org, member } = await makeTeam();
    const { integration } = await connectTelegramDirect(org.id);
    const { fn } = stubTelegram([41, 42]);
    freezeSecond();

    const first = await send(member.id, "first");
    const second = await send(member.id, "second");

    expect(first.status).toBe(200);
    expect(first.json).toEqual({ ok: true });
    expect(second.status).toBe(200); // used to be a 409 although Telegram had already delivered it
    expect(second.json).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(2);

    const rows = await copies(integration.id);
    expect(rows.map((r) => r.messageId)).toEqual([41, 42]);
    expect(rows.map((r) => r.text)).toEqual(["first", "second"]);
    expect(rows.every((r) => r.fromName === "@zaki_test_bot" && r.fromId === null && r.isCommand === false)).toBe(true);
  });

  it("a burst of simultaneous sends all succeed", async () => {
    const { org, member } = await makeTeam();
    const { integration } = await connectTelegramDirect(org.id);
    stubTelegram([101, 102, 103, 104, 105]);
    freezeSecond();
    await loginAs(member.id);

    const results = await Promise.all(
      ["a", "b", "c", "d", "e"].map((text) => call(sendRoute.POST, { url: SEND_URL, body: { chatId: "555001", text } })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await copies(integration.id)).map((r) => r.messageId)).toEqual([101, 102, 103, 104, 105]);
  });

  it("when Telegram's answer has no message_id the copy gets a unique negative id and nothing collides", async () => {
    const { org, member } = await makeTeam();
    const { integration } = await connectTelegramDirect(org.id);
    stubTelegram([null]);
    freezeSecond();

    for (const text of ["one", "two", "three"]) expect((await send(member.id, text)).status, text).toBe(200);

    const ids = (await copies(integration.id)).map((r) => r.messageId);
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => id < 0)).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });

  it("a failing copy can never turn a delivered message into an error (real database failure, both id paths)", async () => {
    const POISONED = "poisoned-chat";
    const { org, member } = await makeTeam();
    const { integration } = await connectTelegramDirect(org.id, { chatId: POISONED });
    const { fn } = stubTelegram([61, null]); // a real id first, then an answer without one
    // The database refuses every insert for this chat. (No spies on Prisma: restoring one
    // removes the method from the shared client for every later test file.)
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION zk_test_poison_tg() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."chatId" = '${POISONED}' THEN RAISE EXCEPTION 'poisoned for the test'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(`CREATE TRIGGER zk_test_poison_tg BEFORE INSERT ON "TelegramMessage" FOR EACH ROW EXECUTE FUNCTION zk_test_poison_tg()`);
    try {
      const withId = await send(member.id, "delivered anyway", POISONED);
      const withoutId = await send(member.id, "delivered anyway too", POISONED);
      expect(withId.status).toBe(200);
      expect(withId.json).toEqual({ ok: true });
      expect(withoutId.status).toBe(200);
      expect(withoutId.json).toEqual({ ok: true });
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS zk_test_poison_tg ON "TelegramMessage"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS zk_test_poison_tg()`);
    }

    expect(fn).toHaveBeenCalledTimes(2);
    expect(await copies(integration.id, POISONED)).toHaveLength(0); // the copies were lost, the messages were not
    const logged = await db.integrationEvent.findMany({ where: { orgId: org.id, type: "telegram.message_sent" } });
    expect(logged.map((l) => l.status)).toEqual(["OK", "OK"]);
  });

  it("a message the sync already stored (a channel echoing the bot's own post) is neither duplicated nor an error", async () => {
    const { org, member } = await makeTeam();
    const { integration } = await connectTelegramDirect(org.id);
    await db.telegramMessage.create({
      data: { orgId: org.id, integrationId: integration.id, chatId: "555001", messageId: 77, fromName: "channel", fromId: null, text: "echo", sentAt: new Date() },
    });
    stubTelegram([77]);

    const res = await send(member.id, "echo");

    expect(res.status).toBe(200);
    const rows = await copies(integration.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fromName).toBe("channel"); // the stored original is left alone
  });

  it("a chat the bot has not synced yet is still sent to; there is simply no thread to add the copy to", async () => {
    const { org, member } = await makeTeam();
    const { integration } = await connectTelegramDirect(org.id);
    stubTelegram([5]);
    const res = await send(member.id, "hello stranger", "999000");
    expect(res.status).toBe(200);
    expect(await copies(integration.id, "999000")).toHaveLength(0);
  });
});

describe("telegram send: unchanged behaviour", () => {
  it("a refusal from Telegram is reported as 400 with its description, and nothing is stored or logged as sent", async () => {
    const { org, member } = await makeTeam();
    const { integration } = await connectTelegramDirect(org.id);
    stubFetch(() => new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), { status: 400 }));
    const res = await send(member.id, "nobody there");
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "Bad Request: chat not found" });
    expect(await copies(integration.id)).toHaveLength(0);
    expect(await db.integrationEvent.count({ where: { orgId: org.id, type: "telegram.message_sent" } })).toBe(0);
  });

  it("an unreachable Telegram is a 400 telegram.unreachable", async () => {
    const { org, member } = await makeTeam();
    await connectTelegramDirect(org.id);
    stubFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND api.telegram.org");
    });
    const res = await send(member.id, "offline");
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "telegram.unreachable" });
  });

  it("guests cannot send, and nothing is sent", async () => {
    const { org, guest } = await makeTeam();
    await connectTelegramDirect(org.id);
    const { fn } = stubTelegram([1]);
    expect((await send(guest.id, "psst")).status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("an organisation without a bot gets a 404", async () => {
    const { member } = await makeTeam();
    const { fn } = stubTelegram([1]);
    expect((await send(member.id, "hello")).status).toBe(404);
    expect(fn).not.toHaveBeenCalled();
  });

  it("the bot token goes to Telegram only, as part of the API path", async () => {
    const { org, member } = await makeTeam();
    await connectTelegramDirect(org.id);
    const { calls } = stubTelegram([9]);
    await send(member.id, "token check");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/^https:\/\/api\.telegram\.org\/bot\d+:[A-Za-z0-9_-]+\/sendMessage$/);
    expect(calls[0]?.body).not.toContain("AAfake_bot_token");
  });
});
