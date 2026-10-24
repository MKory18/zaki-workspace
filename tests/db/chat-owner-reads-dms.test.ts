import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as readRoute from "@/app/api/chat/conversations/[id]/read/route";
import * as oversightList from "@/app/api/chat/oversight/conversations/route";
import * as oversightOne from "@/app/api/chat/oversight/conversations/[id]/route";
import type { ConversationDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * Decision D-2 (the owner, 2026-10-24): the OWNER reads everything, private DMs between two employees
 * included — silently. The oversight door used to refuse a DM («الرسائل الخاصة ما بتنفتح ولا للمالك»)
 * while the policy let him in by URL; now both say the same thing.
 */
async function dmBetweenTwo() {
  const t = await makeTeam();
  await loginAs(t.member.id);
  const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
  const sent = (await call(messagesRoute.POST, { params: { id: dm }, body: { body: "بيني وبينك" } })).json?.["id"] as string;
  return { ...t, dm, sent };
}

describe("the owner reads private DMs, silently (D-2)", () => {
  it("the oversight door opens a DM between two other people, with its words", async () => {
    const w = await dmBetweenTwo();
    await loginAs(w.owner.id);
    const res = await call(oversightOne.GET, { params: { id: w.dm } });
    expect(res.status).toBe(200);
    const detail = res.json as unknown as ConversationDto;
    expect(detail.messages.map((m) => m.body)).toContain("بيني وبينك");
    expect(detail.me.oversight).toBe(true);
    expect(detail.me.canPost).toBe(false); // reading, never writing, in somebody else's DM
  });

  it("the company list names a DM by its two people, and every row opens", async () => {
    const w = await dmBetweenTwo();
    await loginAs(w.owner.id);
    const list = await call(oversightList.GET, { url: "http://localhost/api/chat/oversight/conversations?limit=100" });
    const row = (list.json?.["items"] as Array<{ id: string; kind: string; names?: string[] }>).find((i) => i.id === w.dm);
    expect(row?.kind).toBe("DM");
    expect([...(row?.names ?? [])].sort()).toEqual(["Admin", "Member"]);
  });

  it("his reading leaves no trace for them: no read mark, no event, the sender's tick stays grey", async () => {
    const w = await dmBetweenTwo();
    await loginAs(w.owner.id);
    expect((await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.dm}`, params: { id: w.dm } })).status).toBe(200);
    expect((await call(readRoute.POST, { method: "POST", url: `http://localhost/api/chat/conversations/${w.dm}/read?upTo=${w.sent}`, params: { id: w.dm } })).status).toBe(200);
    expect(await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: w.dm, userId: w.owner.id } } })).toBeNull();
    const events = (await db.realtimeEvent.findMany({ where: { kind: "conversation.read" } })).filter((e) => (e.ids as Record<string, string>)["conversationId"] === w.dm);
    expect(events).toEqual([]);
    await loginAs(w.member.id);
    const mine = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.dm}`, params: { id: w.dm } })).json as unknown as ConversationDto;
    expect(mine.messages.find((m) => m.id === w.sent)?.status).not.toBe("read");
  });

  it("his every look is in the audit trail", async () => {
    const w = await dmBetweenTwo();
    await loginAs(w.owner.id);
    await call(oversightOne.GET, { params: { id: w.dm } });
    const logged = await db.auditLog.findMany({ where: { action: "chat.oversight_read", actorId: w.owner.id } });
    expect(logged.length).toBeGreaterThan(0);
  });

  it("nobody else gets in through the oversight door", async () => {
    const w = await dmBetweenTwo();
    await loginAs(w.guest.id);
    expect((await call(oversightOne.GET, { params: { id: w.dm } })).status).toBe(403);
  });
});
