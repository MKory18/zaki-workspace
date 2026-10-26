import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as listRoute from "@/app/api/watch/route";
import * as sessionRoute from "@/app/api/watch/[id]/route";
import * as endRoute from "@/app/api/watch/[id]/end/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { setWatchFetchForTests } from "@/server/watch/title";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const ID = "dQw4w9WgXcQ";
const LINK = `https://youtu.be/${ID}?t=90`;

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;

/** YouTube's name for a video, faked (no network in tests); `null`: YouTube does not answer. */
let youtubeTitle: string | null = "A talk worth watching";
const asked: string[] = [];
beforeEach(() => {
  youtubeTitle = "A talk worth watching";
  asked.length = 0;
  setWatchFetchForTests(async (input) => {
    asked.push(String(input));
    if (youtubeTitle === null) return new Response("nope", { status: 404 });
    return Response.json({ title: youtubeTitle });
  });
});
afterAll(() => setWatchFetchForTests(null));

/** A company with a space: the member, the admin (space ADMIN), a colleague and a guest are in it; «outsider» is not. */
async function world() {
  const t = await makeTeam();
  const colleague = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Colleague" });
  const outsider = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Outsider" });
  const ws = await makeWorkspace(t.org.id, [
    { userId: t.member.id },
    { userId: colleague.id },
    { userId: t.admin.id, role: "ADMIN" },
    { userId: t.guest.id, role: "GUEST" },
  ]);
  return { ...t, colleague, outsider, ws };
}

async function as(userId: string, spaceId: string) {
  await loginAs(userId);
  jar().set(SPACE_COOKIE, spaceId);
}

async function start(body: Record<string, unknown>) {
  return call(listRoute.POST, { body });
}

describe("«نتفرّج سوا»: starting a session", () => {
  it("a member pastes a link and picks a colleague: a private 🎬 topic of the space for the two of them, the video kept by its id", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const res = await start({ url: LINK, memberIds: [w.colleague.id] });
    expect(res.status).toBe(201);
    const id = res.json?.["id"] as string;
    expect(res.json?.["path"]).toBe(`/watch/${id}`);

    const session = await db.watchSession.findUniqueOrThrow({ where: { id } });
    expect(session).toMatchObject({
      orgId: w.org.id,
      spaceId: w.ws.id,
      hostId: w.member.id,
      sourceKind: "YOUTUBE",
      sourceRef: ID,
      sourceUrl: LINK,
      positionSec: 90,
      playing: false,
      endedAt: null,
      title: "A talk worth watching",
    });
    const topic = await db.conversation.findUniqueOrThrow({ where: { id: session.conversationId }, include: { members: true } });
    expect(topic).toMatchObject({ kind: "TOPIC", spaceId: w.ws.id, restricted: true, emoji: "🎬", title: "A talk worth watching" });
    expect(topic.members.map((m) => m.userId).sort()).toEqual([w.member.id, w.colleague.id].sort());
    // the talk opens with the line that says who started it
    const line = await db.chatMessage.findFirstOrThrow({ where: { conversationId: topic.id, kind: "SYSTEM" } });
    expect(JSON.parse(line.body)).toMatchObject({ k: "watch_started" });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("https://www.youtube.com/oembed?");
  });

  it("the people picked get a word in the bell of that space, with the session's link; the starter does not", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const id = (await start({ url: LINK, memberIds: [w.colleague.id] })).json?.["id"] as string;
    const word = await db.notification.findFirstOrThrow({ where: { userId: w.colleague.id, type: "watch_invite" } });
    expect(word).toMatchObject({ linkUrl: `/watch/${id}`, workspaceId: w.ws.id });
    expect(word.body).toContain("A talk worth watching");
    expect(await db.notification.count({ where: { userId: w.member.id, type: "watch_invite" } })).toBe(0);
  });

  it("a name typed by the starter wins; with YouTube silent the session still starts, under the default name", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const named = await start({ url: LINK, title: "Friday's talk", memberIds: [w.colleague.id] });
    expect((await db.watchSession.findUniqueOrThrow({ where: { id: named.json?.["id"] as string } })).title).toBe("Friday's talk");
    expect(asked).toHaveLength(0); // a typed name asks nobody

    youtubeTitle = null;
    const silent = await start({ url: LINK, memberIds: [w.colleague.id] });
    expect(silent.status).toBe(201);
    expect((await db.watchSession.findUniqueOrThrow({ where: { id: silent.json?.["id"] as string } })).title).toBe("نتفرّج سوا");
  });

  it("«كل ناس المساحة» brings in the space's staff — never its guest, never somebody outside it", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const id = (await start({ url: LINK, everyone: true })).json?.["id"] as string;
    const session = await db.watchSession.findUniqueOrThrow({ where: { id } });
    const members = await db.conversationMember.findMany({ where: { conversationId: session.conversationId } });
    expect(members.map((m) => m.userId).sort()).toEqual([w.member.id, w.colleague.id, w.admin.id].sort());
  });

  it("a link that is not a video it plays is refused with a sentence, and nothing is made", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const before = await db.conversation.count({ where: { spaceId: w.ws.id } });
    for (const url of ["https://example.com/video.mp4", "not a link", `https://youtube.com.evil.example/watch?v=${ID}`]) {
      const res = await start({ url, memberIds: [w.colleague.id] });
      expect(res.status, url).toBe(422);
      expect(JSON.stringify(res.json), url).toContain("watch.e.link");
    }
    expect(await db.conversation.count({ where: { spaceId: w.ws.id } })).toBe(before);
    expect(await db.watchSession.count({ where: { spaceId: w.ws.id } })).toBe(0);
  });

  it("nobody is pulled in from outside the space, and an external partner is never invited", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const outside = await start({ url: LINK, memberIds: [w.outsider.id] });
    expect(outside.status).toBe(403);
    expect(outside.json?.["message"]).toBe("teams.member_not_in_space");
    const guest = await start({ url: LINK, memberIds: [w.guest.id] });
    expect(guest.status).toBe(403);
    expect(guest.json?.["message"]).toBe("watch.e.no_guests");
    expect(await db.watchSession.count({ where: { spaceId: w.ws.id } })).toBe(0);
  });

  it("an external partner can neither start a session nor list them", async () => {
    const w = await world();
    await as(w.guest.id, w.ws.id);
    const res = await start({ url: LINK, memberIds: [w.member.id] });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("guest.no_access");
    expect((await call(listRoute.GET)).status).toBe(403);
  });
});

describe("«نتفرّج سوا»: who sees a session", () => {
  async function started() {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const id = (await start({ url: LINK, memberIds: [w.colleague.id] })).json?.["id"] as string;
    return { ...w, id };
  }

  it("the people it was started for see it in the list and open it; another person of the same space does not even learn it exists", async () => {
    const w = await started();
    for (const person of [w.member, w.colleague]) {
      await as(person.id, w.ws.id);
      const list = await call(listRoute.GET);
      expect((list.json?.["sessions"] as { id: string }[]).map((s) => s.id), person.name).toEqual([w.id]);
      const one = await call(sessionRoute.GET, { params: { id: w.id } });
      expect(one.status, person.name).toBe(200);
      expect(one.json?.["session"]).toMatchObject({ id: w.id, kind: "YOUTUBE", ref: ID, live: true, peopleCount: 2 });
      expect((one.json?.["session"] as { embedUrl: string }).embedUrl).toContain(`youtube-nocookie.com/embed/${ID}`);
    }
    // the space's ADMIN was not picked: a private topic is its own people's
    await as(w.admin.id, w.ws.id);
    expect((await call(listRoute.GET)).json?.["sessions"]).toEqual([]);
    expect((await call(sessionRoute.GET, { params: { id: w.id } })).status).toBe(404);
  });

  it("the owner sees every session silently: listed and opened, without becoming one of its people", async () => {
    const w = await started();
    await as(w.owner.id, w.ws.id);
    expect((await call(listRoute.GET)).json?.["sessions"]).toMatchObject([{ id: w.id }]);
    expect((await call(sessionRoute.GET, { params: { id: w.id } })).status).toBe(200);
    const session = await db.watchSession.findUniqueOrThrow({ where: { id: w.id } });
    expect(await db.conversationMember.count({ where: { conversationId: session.conversationId, userId: w.owner.id } })).toBe(0);
  });

  it("another company's people get nothing, whatever their rank there", async () => {
    const w = await started();
    const foreign = await makeTeam();
    await loginAs(foreign.owner.id);
    expect((await call(sessionRoute.GET, { params: { id: w.id } })).status).toBe(404);
    expect((await call(endRoute.POST, { method: "POST", params: { id: w.id } })).status).toBe(404);
  });

  it("the list is of the space the person is in: a session of another space of theirs is not in it", async () => {
    const w = await started();
    const other = await makeWorkspace(w.org.id, [{ userId: w.member.id }]);
    await as(w.member.id, other.id);
    expect((await call(listRoute.GET)).json?.["sessions"]).toEqual([]);
  });
});

describe("«نتفرّج سوا»: ending a session", () => {
  it("one of its people who did not start it cannot end it; the starter can, the talk stays, and ending twice changes nothing", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const id = (await start({ url: LINK, memberIds: [w.colleague.id] })).json?.["id"] as string;

    await as(w.colleague.id, w.ws.id);
    const refused = await call(endRoute.POST, { method: "POST", params: { id } });
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("watch.e.cannot_end");
    expect((await call(sessionRoute.GET, { params: { id } })).json?.["session"]).toMatchObject({ can: { end: false } });

    await as(w.member.id, w.ws.id);
    expect((await call(sessionRoute.GET, { params: { id } })).json?.["session"]).toMatchObject({ can: { end: true } });
    expect((await call(endRoute.POST, { method: "POST", params: { id } })).status).toBe(200);
    expect((await call(endRoute.POST, { method: "POST", params: { id } })).status).toBe(200);

    const session = await db.watchSession.findUniqueOrThrow({ where: { id } });
    expect(session.endedAt).not.toBeNull();
    const lines = await db.chatMessage.findMany({ where: { conversationId: session.conversationId, kind: "SYSTEM" }, orderBy: { createdAt: "asc" } });
    expect(lines.map((l) => (JSON.parse(l.body) as { k: string }).k)).toEqual(["watch_started", "watch_ended"]);
    // the talk is not closed: it stays like any topic
    expect((await db.conversation.findUniqueOrThrow({ where: { id: session.conversationId } })).closedAt).toBeNull();
    const one = await call(sessionRoute.GET, { params: { id } });
    expect(one.json?.["session"]).toMatchObject({ live: false, can: { end: false } });
  });

  it("the owner ends any session", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const id = (await start({ url: LINK, memberIds: [w.colleague.id] })).json?.["id"] as string;
    await as(w.owner.id, w.ws.id);
    expect((await call(endRoute.POST, { method: "POST", params: { id } })).status).toBe(200);
    expect((await db.watchSession.findUniqueOrThrow({ where: { id } })).endedAt).not.toBeNull();
  });

  it("deleting the space takes its sessions with it", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const id = (await start({ url: LINK, memberIds: [w.colleague.id] })).json?.["id"] as string;
    await db.conversation.deleteMany({ where: { spaceId: w.ws.id } });
    expect(await db.watchSession.count({ where: { id } })).toBe(0);
  });
});
