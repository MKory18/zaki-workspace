import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as listRoute from "@/app/api/watch/route";
import * as sessionRoute from "@/app/api/watch/[id]/route";
import * as endRoute from "@/app/api/watch/[id]/end/route";
import * as remoteRoute from "@/app/api/watch/[id]/remote/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
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

describe("«نتفرّج سوا»: the remote keeps every screen on the same second", () => {
  async function started(extra: Record<string, unknown> = {}) {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const id = (await start({ url: LINK, memberIds: [w.colleague.id], ...extra })).json?.["id"] as string;
    return { ...w, id };
  }
  const press = (id: string, body: Record<string, unknown>) => call(remoteRoute.POST, { method: "POST", params: { id }, body });
  const remoteOf = (id: string) => call(remoteRoute.GET, { params: { id } });
  const hand = (id: string, body: Record<string, unknown>) => call(remoteRoute.PATCH, { method: "PATCH", params: { id }, body });

  it("a new session waits paused at the link's second, held by its starter, with the server's clock", async () => {
    const w = await started();
    const before = Date.now();
    const res = await remoteOf(w.id);
    expect(res.status).toBe(200);
    const remote = res.json?.["remote"] as Record<string, unknown>;
    expect(remote).toMatchObject({ hostId: w.member.id, everyoneControls: false, live: true, can: { press: true, handOver: true } });
    expect(remote["state"]).toMatchObject({ playing: false, positionSec: 90, version: 0 });
    expect(remote["serverNow"] as number).toBeGreaterThanOrEqual(before);
  });

  it("the host presses play: the state is written with the server's clock, one version up, and the session's people are told", async () => {
    const w = await started();
    const session = await db.watchSession.findUniqueOrThrow({ where: { id: w.id } });
    const events = await db.realtimeEvent.count({ where: { kind: "watch.changed" } });
    const at = Date.now();
    const res = await press(w.id, { playing: true, positionSec: 95.5 });
    expect(res.status).toBe(200);
    expect((res.json?.["remote"] as { state: Record<string, unknown> }).state).toMatchObject({ playing: true, positionSec: 95.5, version: 1 });
    const row = await db.watchSession.findUniqueOrThrow({ where: { id: w.id } });
    expect(row.stateAt.getTime()).toBeGreaterThanOrEqual(at - 5);
    // the event carries ids only: the conversation (so only its readers get it), never the state itself
    const rows = await db.realtimeEvent.findMany({ where: { kind: "watch.changed" }, orderBy: { createdAt: "desc" } });
    expect(rows.length).toBe(events + 1);
    expect(rows[0]!.ids).toMatchObject({ conversationId: session.conversationId, spaceId: w.ws.id });
    expect(JSON.stringify(rows[0]!.ids)).not.toContain("95.5");

    // the colleague (who follows) reads the same state
    await as(w.colleague.id, w.ws.id);
    const theirs = await remoteOf(w.id);
    expect(theirs.json?.["remote"]).toMatchObject({ state: { playing: true, positionSec: 95.5, version: 1 }, can: { press: false, handOver: false } });
  });

  it("somebody who follows cannot press, and the state does not move", async () => {
    const w = await started();
    await as(w.colleague.id, w.ws.id);
    const res = await press(w.id, { playing: true, positionSec: 10 });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("watch.e.not_remote");
    expect(await db.watchSession.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({ playing: false, positionSec: 90, version: 0 });
  });

  it("a wrong second (negative, more than a day, not a number) is refused before anything moves", async () => {
    const w = await started();
    for (const positionSec of [-1, 86_401, "12"]) expect((await press(w.id, { playing: true, positionSec })).status, String(positionSec)).toBe(422);
    expect((await db.watchSession.findUniqueOrThrow({ where: { id: w.id } })).version).toBe(0);
  });

  it("the host hands the remote to the colleague: now they press, the starter follows", async () => {
    const w = await started();
    const res = await hand(w.id, { hostId: w.colleague.id });
    expect(res.status).toBe(200);
    expect(res.json?.["remote"]).toMatchObject({ hostId: w.colleague.id, can: { press: false } });
    expect((await press(w.id, { playing: true, positionSec: 1 })).status).toBe(403);
    await as(w.colleague.id, w.ws.id);
    expect((await press(w.id, { playing: true, positionSec: 1 })).status).toBe(200);
    // the session still says who started it, and the starter may still end it
    await as(w.member.id, w.ws.id);
    const one = await call(sessionRoute.GET, { params: { id: w.id } });
    expect(one.json?.["session"]).toMatchObject({ host: { id: w.member.id }, remote: { hostId: w.colleague.id }, can: { end: true } });
    expect((await call(listRoute.GET)).json?.["sessions"]).toMatchObject([{ host: { id: w.member.id } }]);
    expect((await call(endRoute.POST, { method: "POST", params: { id: w.id } })).status).toBe(200);
  });

  it("the remote goes only to one of the session's people: not to somebody of the space it was not started for, not to a guest", async () => {
    const w = await started();
    for (const person of [w.admin, w.guest, w.outsider]) {
      const res = await hand(w.id, { hostId: person.id });
      expect(res.status, person.name).toBe(403);
      expect(res.json?.["message"], person.name).toBe("watch.e.not_member");
    }
    expect((await db.watchSession.findUniqueOrThrow({ where: { id: w.id } })).hostId).toBe(w.member.id);
  });

  it("«الكل بيتحكّم»: with it on, everybody of the session presses; only the host may switch it", async () => {
    const w = await started();
    await as(w.colleague.id, w.ws.id);
    expect((await hand(w.id, { everyoneControls: true })).status).toBe(403);
    await as(w.member.id, w.ws.id);
    expect((await hand(w.id, { everyoneControls: true })).json?.["remote"]).toMatchObject({ everyoneControls: true });
    await as(w.colleague.id, w.ws.id);
    const res = await press(w.id, { playing: true, positionSec: 30 });
    expect(res.status).toBe(200);
    expect((res.json?.["remote"] as { can: Record<string, boolean> }).can).toMatchObject({ press: true, handOver: false });
  });

  it("the owner may hand the remote over (silently, he follows like everybody), but does not press it himself", async () => {
    const w = await started();
    await as(w.owner.id, w.ws.id);
    expect((await remoteOf(w.id)).json?.["remote"]).toMatchObject({ can: { press: false, handOver: true } });
    expect((await press(w.id, { playing: true, positionSec: 1 })).status).toBe(403);
    expect((await hand(w.id, { hostId: w.colleague.id })).status).toBe(200);
  });

  it("an ended session takes no press and no hand-over, and stops playing for everybody", async () => {
    const w = await started();
    await press(w.id, { playing: true, positionSec: 100 });
    expect((await call(endRoute.POST, { method: "POST", params: { id: w.id } })).status).toBe(200);
    expect((await press(w.id, { playing: true, positionSec: 1 })).json?.["message"]).toBe("watch.e.ended");
    expect((await hand(w.id, { everyoneControls: true })).json?.["message"]).toBe("watch.e.ended");
    expect((await remoteOf(w.id)).json?.["remote"]).toMatchObject({ live: false, state: { playing: false }, can: { press: false, handOver: false } });
  });

  it("nobody outside the session learns its remote: the space's admin who was not picked, another company, a guest", async () => {
    const w = await started();
    await as(w.admin.id, w.ws.id);
    expect((await remoteOf(w.id)).status).toBe(404);
    expect((await press(w.id, { playing: true, positionSec: 1 })).status).toBe(404);
    await as(w.guest.id, w.ws.id);
    expect((await remoteOf(w.id)).status).toBe(403);
    const foreign = await makeTeam();
    await loginAs(foreign.owner.id);
    expect((await remoteOf(w.id)).status).toBe(404);
    expect((await hand(w.id, { everyoneControls: true })).status).toBe(404);
  });
});

describe("«نتفرّج سوا»: a comment keeps the moment of the video it was written at", () => {
  async function started() {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const id = (await start({ url: LINK, memberIds: [w.colleague.id] })).json?.["id"] as string;
    const session = await db.watchSession.findUniqueOrThrow({ where: { id } });
    return { ...w, id, conversationId: session.conversationId };
  }
  const comment = (conversationId: string, body: Record<string, unknown>) =>
    call(messagesRoute.POST, { method: "POST", params: { id: conversationId }, body });

  it("a comment in the session's talk is stored with its second, and every reader of the talk sees it", async () => {
    const w = await started();
    const res = await comment(w.conversationId, { body: "هون الفكرة كلها", videoAtSec: 754.25 });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ body: "هون الفكرة كلها", videoAtSec: 754.25 });
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: res.json?.["id"] as string } });
    expect(row.videoAtSec).toBe(754.25);

    await as(w.colleague.id, w.ws.id);
    const detail = await call(conversationRoute.GET, { params: { id: w.conversationId }, url: `http://localhost/api/chat/conversations/${w.conversationId}?limit=50` });
    expect(detail.status).toBe(200);
    expect((detail.json?.["messages"] as { body: string | null; videoAtSec?: number }[]).find((m) => m.body === "هون الفكرة كلها")).toMatchObject({ videoAtSec: 754.25 });
  });

  it("a comment without a moment stays an ordinary message (no second on it)", async () => {
    const w = await started();
    const res = await comment(w.conversationId, { body: "مرحبا" });
    expect(res.status).toBe(201);
    expect(res.json?.["videoAtSec"]).toBeUndefined();
  });

  it("a moment means nothing outside a watching session: in an ordinary topic it is dropped", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "General" } });
    const res = await comment(topic.id, { body: "عادي", videoAtSec: 30 });
    expect(res.status).toBe(201);
    expect(res.json?.["videoAtSec"]).toBeUndefined();
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: res.json?.["id"] as string } })).videoAtSec).toBeNull();
  });

  it("a wrong second (negative, more than a day, not a number) is refused and nothing is written", async () => {
    const w = await started();
    const before = await db.chatMessage.count({ where: { conversationId: w.conversationId } });
    for (const videoAtSec of [-1, 86_401, "12"]) {
      expect((await comment(w.conversationId, { body: "x", videoAtSec })).status, String(videoAtSec)).toBe(422);
    }
    expect(await db.chatMessage.count({ where: { conversationId: w.conversationId } })).toBe(before);
  });

  it("somebody the session was not started for cannot comment in it", async () => {
    const w = await started();
    await as(w.admin.id, w.ws.id);
    const res = await comment(w.conversationId, { body: "أنا كمان", videoAtSec: 3 });
    expect([403, 404]).toContain(res.status);
  });
});
