import { describe, expect, it } from "vitest";
import * as searchRoute from "@/app/api/search/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as convSearchRoute from "@/app/api/chat/conversations/[id]/search/route";
import { snippetOf } from "@/server/chat/search";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeUser, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

/**
 * SEARCH IN THE CHAT (the owner's ask, 2026-10-25): inside one conversation, and — from the search box — the topics,
 * messages, people and files of the space the person is in. Nothing is found by somebody who could not open it: a
 * topic of another «مقطع», another space's talk, a deleted message, a system line.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

type Hit = { id: string; snippet: string; conversationId: string };
type Body = { topics: { id: string }[]; messages: Hit[]; people: { id: string }[]; files: { id: string }[] };

async function world() {
  const w = await makeTeamsWorld();
  const word = `zq${uid().slice(0, 6)}`;
  const topic = (title: string, spaceId: string, teamId: string | null = null) =>
    db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId, title, teamId } });
  const open = await topic(`Plan ${word}`, w.s.id);
  const ty = await topic(`Y ${word}`, w.s.id, w.y.id);
  const elsewhere = await topic(`Other ${word}`, w.other.id);
  const say = (conversationId: string, body: string, extra: Record<string, unknown> = {}) =>
    db.chatMessage.create({ data: { orgId: w.org.id, conversationId, authorId: w.spaceAdmin.id, body, ...extra } });
  return { ...w, word, open, ty, elsewhere, say };
}

describe("search inside one conversation", () => {
  it("its messages that carry the words — never a deleted one, a system line, or another conversation's", async () => {
    const w = await world();
    const hit = await w.say(w.open.id, `the ${w.word} is ready`);
    await w.say(w.open.id, `gone ${w.word}`, { deletedAt: new Date() });
    await w.say(w.open.id, `{"k":"join","x":"${w.word}"}`, { kind: "SYSTEM" });
    await w.say(w.ty.id, `Y has ${w.word} too`);
    await loginAs(w.carol.id);
    const res = await call(convSearchRoute.GET, { url: `http://localhost/x?q=${w.word}`, params: { id: w.open.id } });
    expect(res.status).toBe(200);
    expect((res.json as { hits: Hit[] }).hits.map((h) => h.id)).toEqual([hit.id]);
  });

  it("a conversation one cannot open is «not found», searched or not", async () => {
    const w = await world();
    await w.say(w.ty.id, `Y has ${w.word}`);
    await loginAs(w.carol.id);
    expect((await call(convSearchRoute.GET, { url: `http://localhost/x?q=${w.word}`, params: { id: w.ty.id } })).status).toBe(404);
  });
});

describe("opening a conversation around one message (a search hit)", () => {
  it("the page carries that message with the ones around it, not just the newest", async () => {
    const w = await world();
    const base = Date.now() - 200 * 60_000;
    const rows = await Promise.all(
      Array.from({ length: 120 }, (_, i) => w.say(w.open.id, `m${i}`, { createdAt: new Date(base + i * 60_000) })),
    );
    const old = rows[10]!;
    await loginAs(w.carol.id);
    const res = await call(conversationRoute.GET, { url: `http://localhost/x?around=${old.id}&limit=40`, params: { id: w.open.id } });
    expect(res.status).toBe(200);
    const ids = (res.json as { messages: { id: string }[] }).messages.map((m) => m.id);
    expect(ids).toContain(old.id);
    expect(ids).toContain(rows[11]!.id);
    expect(ids).toContain(rows[9]!.id);
    expect(ids).not.toContain(rows[119]!.id);
    // oldest first, as always
    expect(ids.indexOf(rows[9]!.id)).toBeLessThan(ids.indexOf(old.id));

    // a message of another conversation is no anchor here
    const foreign = await w.say(w.ty.id, "elsewhere");
    expect((await call(conversationRoute.GET, { url: `http://localhost/x?around=${foreign.id}`, params: { id: w.open.id } })).status).toBe(404);
  });
});

describe("the search box: the chat, people and files of the space one is in", () => {
  const search = async (q: string) => (await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(q)}` })).json as unknown as Body;

  it("topics and messages one may open, in this space only", async () => {
    const w = await world();
    const mine = await w.say(w.open.id, `about ${w.word}`);
    await w.say(w.ty.id, `Y about ${w.word}`);
    await w.say(w.elsewhere.id, `there ${w.word}`);
    await loginAs(w.bob.id);
    enter(w.s.id);
    // bob is in «مقطع» Y: he finds its topic too, but nothing of the other space he is in
    const bob = await search(w.word);
    expect(bob.topics.map((t) => t.id).sort()).toEqual([w.open.id, w.ty.id].sort());
    expect(bob.messages.map((m) => m.conversationId)).not.toContain(w.elsewhere.id);

    await loginAs(w.carol.id);
    const carol = await search(w.word);
    expect(carol.topics.map((t) => t.id)).toEqual([w.open.id]);
    expect(carol.messages.map((m) => m.id)).toEqual([mine.id]);
    expect(carol.messages[0]!.snippet).toContain(w.word);
  });

  it("an archived topic is not offered by its name", async () => {
    const w = await world();
    await db.conversation.update({ where: { id: w.open.id }, data: { archivedAt: new Date(), closedAt: new Date() } });
    await loginAs(w.carol.id);
    enter(w.s.id);
    expect((await search(w.word)).topics).toEqual([]);
  });

  it("the people of this space and its library files — not another space's", async () => {
    const w = await world();
    const stranger = await makeUser({ orgId: w.org.id, role: "MEMBER", name: `Alicia ${uid()}` });
    const file = (name: string, workspaceId: string) =>
      db.storedFile.create({
        data: { orgId: w.org.id, uploaderId: w.spaceAdmin.id, familyId: `f_${uid()}`, name, mimeType: "text/plain", size: 1, path: `p_${uid()}`, purpose: "LIBRARY", workspaceId },
      });
    const here = await file(`brief-${w.word}.txt`, w.s.id);
    await file(`brief-${w.word}-other.txt`, w.other.id);
    await loginAs(w.carol.id);
    enter(w.s.id);
    const body = await search("Ali");
    expect(body.people.map((p) => p.id)).toContain(w.alice.id);
    expect(body.people.map((p) => p.id)).not.toContain(stranger.id);
    expect((await search(`brief-${w.word}`)).files.map((f) => f.id)).toEqual([here.id]);
  });
});

describe("a guest's search box", () => {
  it("no people and no library: a guest has no staff directory and no library", async () => {
    const w = await world();
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `Guest ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    await db.storedFile.create({
      data: { orgId: w.org.id, uploaderId: w.spaceAdmin.id, familyId: `f_${uid()}`, name: `Alice-${w.word}.txt`, mimeType: "text/plain", size: 1, path: `p_${uid()}`, purpose: "LIBRARY", workspaceId: w.s.id },
    });
    await loginAs(guest.id);
    enter(w.s.id);
    const body = (await call(searchRoute.GET, { url: "http://localhost/api/search?q=Ali" })).json as unknown as Body;
    expect(body.people).toEqual([]);
    expect(body.files).toEqual([]);
  });
});

describe("the snippet", () => {
  it("is the words with some text around them, cut with «…»", () => {
    const long = `${"a".repeat(200)} needle ${"b".repeat(200)}`;
    const s = snippetOf(long, "needle", 60);
    expect(s).toContain("needle");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(snippetOf("short one", "one")).toBe("short one");
  });
});
