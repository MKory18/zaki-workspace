import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as joinRoute from "@/app/api/chat/conversations/[id]/join/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as forwardRoute from "@/app/api/chat/messages/[id]/forward/route";
import * as voteRoute from "@/app/api/chat/messages/[id]/poll/vote/route";
import * as closeRoute from "@/app/api/chat/messages/[id]/poll/close/route";
import type { ConversationDto, MessageDto, PollDto } from "@/server/chat/dto";
import { call, db, loginAs, makeOrg, makeTeam, makeUser, makeWorkspace } from "./helpers";

const detail = async (id: string) =>
  (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } })).json as unknown as ConversationDto;
const pollOf = async (conversationId: string, messageId: string): Promise<PollDto | undefined> =>
  (await detail(conversationId)).messages.find((m) => m.id === messageId)?.poll;
const send = (id: string, body: string, poll: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  call(messagesRoute.POST, { params: { id }, body: { body, poll, ...extra } });
const vote = (id: string, optionIds: string[]) => call(voteRoute.PUT, { method: "PUT", params: { id }, body: { optionIds } });
const close = (id: string) => call(closeRoute.POST, { params: { id } });

async function world() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [
    { userId: t.member.id },
    { userId: t.admin.id, role: "ADMIN" },
    { userId: t.guest.id, role: "GUEST" },
  ]);
  const second = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Second" });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: second.id, role: "MEMBER" } });
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  return { ...t, ws, second, topic };
}

/** A member asks; returns the message id and its option ids (in order). */
async function ask(w: Awaited<ReturnType<typeof world>>, poll: Record<string, unknown> = {}, asker = w.member.id) {
  await loginAs(asker);
  const res = await send(w.topic.id, "وين نتغدى؟", { options: ["شاورما", "برغر", "فلافل"], ...poll });
  expect(res.status, res.text).toBe(201);
  const dto = res.json as unknown as MessageDto;
  return { id: dto.id, options: dto.poll!.options.map((o) => o.id), dto };
}

describe("polls: creating one", () => {
  it("a member who may post asks a question: a POLL message whose body is the question, options in order", async () => {
    const w = await world();
    const p = await ask(w, { multiple: true, anonymous: false });
    expect(p.dto.kind).toBe("POLL");
    expect(p.dto.body).toBe("وين نتغدى؟");
    expect(p.dto.poll).toMatchObject({ multiple: true, anonymous: false, closed: false, closesAt: null, voters: 0, canVote: true, canClose: true });
    expect(p.dto.poll!.options.map((o) => o.text)).toEqual(["شاورما", "برغر", "فلافل"]);
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: p.id }, include: { poll: { include: { options: true } } } });
    expect(row.kind).toBe("POLL");
    expect(row.poll?.options).toHaveLength(3);

    await loginAs(w.second.id);
    const seen = await pollOf(w.topic.id, p.id);
    expect(seen).toMatchObject({ canVote: true, canClose: false, voters: 0 });
    // it rang the same bell as any message
    const rt = await db.realtimeEvent.findMany({ where: { orgId: w.org.id, kind: "message.created" } });
    expect(rt.some((e) => (e.ids as { messageId?: string }).messageId === p.id)).toBe(true);
  });

  it("2 to 10 distinct options of at most 100 characters, a question, a deadline of at most 7 days", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const bad = async (poll: Record<string, unknown>, body = "سؤال؟") => (await send(w.topic.id, body, poll)).status;
    expect(await bad({ options: ["واحد"] })).toBe(422);
    expect(await bad({ options: ["واحد", "  "] })).toBe(422);
    expect(await bad({ options: ["أ", "أ"] })).toBe(422);
    expect(await bad({ options: Array.from({ length: 11 }, (_, i) => `خيار ${i}`) })).toBe(422);
    expect(await bad({ options: ["أ", "ب".repeat(101)] })).toBe(422);
    expect(await bad({ options: ["أ", "ب"], closesInMinutes: 7 * 24 * 60 + 1 })).toBe(422);
    expect(await bad({ options: ["أ", "ب"], closesInMinutes: 0 })).toBe(422);
    expect(await bad({ options: ["أ", "ب"] }, "   ")).toBeGreaterThanOrEqual(400);
    expect(await db.poll.count({ where: { message: { orgId: w.org.id } } })).toBe(0);

    expect(await bad({ options: Array.from({ length: 10 }, (_, i) => `خيار ${i}`) })).toBe(201);
    const week = await send(w.topic.id, "أسبوع؟", { options: ["أ", "ب"], closesInMinutes: 7 * 24 * 60 });
    expect(week.status).toBe(201);
    const closesAt = new Date((week.json as unknown as MessageDto).poll!.closesAt!).getTime();
    expect(Math.abs(closesAt - (Date.now() + 7 * 24 * 3600_000))).toBeLessThan(60_000);
  });

  it("only in a topic, never for a guest, never with a file or a voice note, and only if he may post", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.admin.id } })).json?.["id"] as string;
    const inDm = await send(dm, "هل؟", { options: ["أ", "ب"] });
    expect(inDm.status).toBe(403);
    expect(inDm.text).toContain("chat.e.poll_topic_only");

    await loginAs(w.guest.id);
    const guest = await send(w.topic.id, "سؤال؟", { options: ["أ", "ب"] });
    expect(guest.status).toBe(403);
    expect(guest.text).toContain("chat.e.poll_guest");
    expect((await detail(w.topic.id)).me.canPoll).toBe(false);

    await loginAs(w.member.id);
    expect((await detail(w.topic.id)).me.canPoll).toBe(true);
    const withFile = await send(w.topic.id, "سؤال؟", { options: ["أ", "ب"] }, { attachmentIds: ["nope"] });
    expect(withFile.status).toBe(422);

    // an announcements-style topic that only admins post in: the member may not ask
    const quiet = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "إعلانات", postingPolicy: "ADMINS" } });
    const denied = await send(quiet.id, "سؤال؟", { options: ["أ", "ب"] });
    expect(denied.status).toBe(403);
    expect((await detail(quiet.id)).me.canPoll).toBe(false);
  });

  it("a retry with the same clientId is the same poll, not a second one", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = await send(w.topic.id, "مرتين؟", { options: ["أ", "ب"] }, { clientId: "poll-once" });
    const b = await send(w.topic.id, "مرتين؟", { options: ["أ", "ب"] }, { clientId: "poll-once" });
    expect((a.json as unknown as MessageDto).id).toBe((b.json as unknown as MessageDto).id);
    expect(await db.poll.count({ where: { message: { authorId: w.member.id } } })).toBe(1);
  });

  it("its words cannot be edited or forwarded (people voted on them)", async () => {
    const w = await world();
    const p = await ask(w);
    const edit = await call(messageRoute.PATCH, { method: "PATCH", params: { id: p.id }, body: { body: "غيّرت السؤال" } });
    expect(edit.status).toBe(403);
    expect(edit.text).toContain("chat.e.poll_immutable");
    const other = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "Other" } });
    const fwd = await call(forwardRoute.POST, { params: { id: p.id }, body: { conversationId: other.id } });
    expect(fwd.status).toBe(403);
    expect(fwd.text).toContain("chat.e.poll_immutable");
  });
});

describe("polls: voting", () => {
  it("single choice: a new choice replaces the old one, an empty set withdraws it; counts and percentages follow", async () => {
    const w = await world();
    const p = await ask(w);
    await loginAs(w.member.id);
    expect((await vote(p.id, [p.options[0]!])).status).toBe(200);
    await loginAs(w.second.id);
    expect((await vote(p.id, [p.options[0]!])).status).toBe(200);
    await loginAs(w.admin.id);
    const third = await vote(p.id, [p.options[1]!]);
    const poll = (third.json as unknown as MessageDto).poll!;
    expect(poll.voters).toBe(3);
    expect(poll.options.map((o) => o.count)).toEqual([2, 1, 0]);
    expect(poll.options.map((o) => o.percent)).toEqual([67, 33, 0]);
    expect(poll.options.map((o) => o.mine)).toEqual([false, true, false]);

    // change: the admin moves to the third option, and the second loses him
    const moved = (await vote(p.id, [p.options[2]!])).json as unknown as MessageDto;
    expect(moved.poll!.options.map((o) => o.count)).toEqual([2, 0, 1]);
    expect(await db.pollVote.count({ where: { pollId: moved.poll!.id, userId: w.admin.id } })).toBe(1);

    // withdraw
    const gone = (await vote(p.id, [])).json as unknown as MessageDto;
    expect(gone.poll!.voters).toBe(2);
    expect(gone.poll!.options.every((o) => !o.mine)).toBe(true);

    // single choice takes one option; an option of another poll is no option here
    expect((await vote(p.id, [p.options[0]!, p.options[1]!])).text).toContain("chat.e.poll_single");
    const strange = await vote(p.id, ["not-an-option"]);
    expect(strange.status).toBe(422);
    expect(strange.text).toContain("chat.e.poll_bad_option");
  });

  it("multiple choice: several options at once, the same option twice counts once", async () => {
    const w = await world();
    const p = await ask(w, { multiple: true });
    await loginAs(w.second.id);
    const res = (await vote(p.id, [p.options[0]!, p.options[2]!, p.options[0]!])).json as unknown as MessageDto;
    expect(res.poll!.options.map((o) => o.count)).toEqual([1, 0, 1]);
    expect(res.poll!.voters).toBe(1);
    expect(res.poll!.options.map((o) => o.percent)).toEqual([100, 0, 100]);
    expect(await db.pollVote.count({ where: { pollId: res.poll!.id } })).toBe(2);
  });

  it("a vote rings poll.voted with the conversation and message only, never who voted", async () => {
    const w = await world();
    const p = await ask(w);
    await loginAs(w.second.id);
    await vote(p.id, [p.options[0]!]);
    const events = await db.realtimeEvent.findMany({ where: { orgId: w.org.id, kind: "poll.voted" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.ids).toEqual({ conversationId: w.topic.id, messageId: p.id, spaceId: w.ws.id });
  });

  it("somebody who may not read the topic cannot vote: another company, another space, a restricted topic they are not in", async () => {
    const w = await world();
    const p = await ask(w);

    const otherOrg = await makeOrg();
    const stranger = await makeUser({ orgId: otherOrg.id, role: "MEMBER" });
    await loginAs(stranger.id);
    expect((await vote(p.id, [p.options[0]!])).status).toBe(404);

    const outsider = await makeUser({ orgId: w.org.id, role: "MEMBER" });
    await makeWorkspace(w.org.id, [{ userId: outsider.id }]);
    await loginAs(outsider.id);
    expect((await vote(p.id, [p.options[0]!])).status).toBe(404);

    await db.conversation.update({ where: { id: w.topic.id }, data: { restricted: true } });
    await loginAs(w.second.id);
    expect((await vote(p.id, [p.options[0]!])).status).toBe(404);
    expect(await db.pollVote.count({ where: { option: { id: p.options[0]! } } })).toBe(0);
  });

  it("voting is allowed for somebody the topic's posting policy keeps from writing", async () => {
    const w = await world();
    const p = await ask(w, {}, w.admin.id);
    await db.conversation.update({ where: { id: w.topic.id }, data: { postingPolicy: "ADMINS" } });
    await loginAs(w.second.id);
    expect((await vote(p.id, [p.options[1]!])).status).toBe(200);
  });
});

describe("polls: who sees what", () => {
  it("a poll that is not anonymous shows who voted for what to the topic's people; an anonymous one shows nobody to anybody", async () => {
    const w = await world();
    const open = await ask(w);
    const secret = await ask(w, { anonymous: true });
    await loginAs(w.second.id);
    await vote(open.id, [open.options[0]!]);
    await vote(secret.id, [secret.options[0]!]);

    for (const viewer of [w.member.id, w.admin.id, w.second.id, w.owner.id]) {
      await loginAs(viewer);
      const a = await pollOf(w.topic.id, open.id);
      expect(a!.options[0]!.voters).toEqual([{ id: w.second.id, name: "Second" }]);
      expect(a!.options[1]!.voters).toEqual([]);
      const b = await pollOf(w.topic.id, secret.id);
      expect(b!.options[0]!.count).toBe(1);
      for (const o of b!.options) expect(o.voters).toBeUndefined();
    }
    // the raw payload of an anonymous poll never carries the voter's id or name, whoever asks
    await loginAs(w.admin.id);
    const raw = JSON.stringify((await detail(w.topic.id)).messages.find((m) => m.id === secret.id));
    expect(raw).not.toContain(w.second.id);
    expect(raw).not.toContain("Second");
    // …but he still sees his own choice on it
    await loginAs(w.second.id);
    expect((await pollOf(w.topic.id, secret.id))!.options[0]!.mine).toBe(true);
  });

  it("a guest reads the counts, never the names, and never votes", async () => {
    const w = await world();
    const p = await ask(w);
    await loginAs(w.second.id);
    await vote(p.id, [p.options[0]!]);

    await loginAs(w.guest.id);
    const seen = await pollOf(w.topic.id, p.id);
    expect(seen).toMatchObject({ voters: 1, canVote: false, canClose: false });
    expect(seen!.options[0]!.count).toBe(1);
    for (const o of seen!.options) expect(o.voters).toBeUndefined();
    const refused = await vote(p.id, [p.options[1]!]);
    expect(refused.status).toBe(403);
    expect(refused.text).toContain("chat.e.poll_guest");
    expect((await close(p.id)).status).toBe(403);
    expect(await db.pollVote.count({ where: { userId: w.guest.id } })).toBe(0);
  });

  it("the owner in silent oversight never votes and is never counted: refused, and nothing is written", async () => {
    const w = await world();
    const p = await ask(w);
    await loginAs(w.second.id);
    await vote(p.id, [p.options[0]!]);

    await loginAs(w.owner.id);
    const reading = await pollOf(w.topic.id, p.id);
    expect(reading).toMatchObject({ voters: 1, canVote: false, canClose: false });
    const refused = await vote(p.id, [p.options[0]!]);
    expect(refused.status).toBe(403);
    expect(refused.text).toContain("chat.e.join_first");
    expect((await close(p.id)).text).toContain("chat.e.join_first");
    expect(await db.pollVote.count({ where: { userId: w.owner.id } })).toBe(0);
    expect((await db.poll.findUniqueOrThrow({ where: { messageId: p.id } })).closedAt).toBeNull();
    // reading left no trace: no row of his in the topic, no poll event
    expect(await db.conversationMember.count({ where: { conversationId: w.topic.id, userId: w.owner.id } })).toBe(0);
    expect(await db.realtimeEvent.count({ where: { orgId: w.org.id, kind: "poll.voted" } })).toBe(1);

    // the others never see him among the voters
    await loginAs(w.member.id);
    expect((await pollOf(w.topic.id, p.id))!.options.flatMap((o) => o.voters ?? []).map((v) => v.id)).toEqual([w.second.id]);

    // once he has joined, he is one of them: his vote counts and shows
    await loginAs(w.owner.id);
    expect((await call(joinRoute.POST, { url: `http://localhost/api/chat/conversations/${w.topic.id}/join`, params: { id: w.topic.id } })).status).toBe(200);
    expect((await pollOf(w.topic.id, p.id))!.canVote).toBe(true);
    const joined = (await vote(p.id, [p.options[1]!])).json as unknown as MessageDto;
    expect(joined.poll!.voters).toBe(2);
  });
});

describe("polls: closing", () => {
  it("the creator closes it early; afterwards nobody votes, and the results stay", async () => {
    const w = await world();
    const p = await ask(w);
    await loginAs(w.second.id);
    await vote(p.id, [p.options[0]!]);
    expect((await close(p.id)).text).toContain("chat.e.poll_close_denied");

    await loginAs(w.member.id);
    const closed = (await close(p.id)).json as unknown as MessageDto;
    expect(closed.poll).toMatchObject({ closed: true, canVote: false, canClose: false, voters: 1 });
    const row = await db.poll.findUniqueOrThrow({ where: { messageId: p.id } });
    expect(row.closedById).toBe(w.member.id);

    await loginAs(w.second.id);
    const late = await vote(p.id, [p.options[1]!]);
    expect(late.status).toBe(403);
    expect(late.text).toContain("chat.e.poll_closed");
    expect((await vote(p.id, [])).status).toBe(403); // not even a withdrawal
    expect((await pollOf(w.topic.id, p.id))!.options[0]!.count).toBe(1);
    expect((await close(p.id)).status).toBe(403);
    // the close rang the poll bell
    expect(await db.realtimeEvent.count({ where: { orgId: w.org.id, kind: "poll.voted" } })).toBe(2);
  });

  it("a moderator of the topic closes somebody else's poll; an ordinary member cannot", async () => {
    const w = await world();
    const p = await ask(w);
    await loginAs(w.second.id);
    expect((await pollOf(w.topic.id, p.id))!.canClose).toBe(false);
    expect((await close(p.id)).status).toBe(403);
    await loginAs(w.admin.id);
    expect((await pollOf(w.topic.id, p.id))!.canClose).toBe(true);
    expect(((await close(p.id)).json as unknown as MessageDto).poll!.closed).toBe(true);
  });

  it("the deadline closes it by itself: after it, a vote is refused and the poll reads as closed", async () => {
    const w = await world();
    const p = await ask(w, { closesInMinutes: 60 });
    await loginAs(w.second.id);
    expect((await vote(p.id, [p.options[0]!])).status).toBe(200);
    await db.poll.update({ where: { messageId: p.id }, data: { closesAt: new Date(Date.now() - 1000) } });
    const late = await vote(p.id, [p.options[1]!]);
    expect(late.status).toBe(403);
    expect(late.text).toContain("chat.e.poll_closed");
    const seen = await pollOf(w.topic.id, p.id);
    expect(seen).toMatchObject({ closed: true, canVote: false, canClose: false, voters: 1 });
  });
});

describe("polls: a deleted message", () => {
  it("hides its poll for everybody, and nothing can be voted on or closed there", async () => {
    const w = await world();
    const p = await ask(w);
    await loginAs(w.second.id);
    await vote(p.id, [p.options[0]!]);
    await loginAs(w.member.id);
    expect((await call(messageRoute.DELETE, { method: "DELETE", params: { id: p.id } })).status).toBeLessThan(300);

    for (const viewer of [w.second.id, w.member.id, w.guest.id, w.owner.id]) {
      await loginAs(viewer);
      const msg = (await detail(w.topic.id)).messages.find((m) => m.id === p.id)!;
      expect(msg.deleted).toBe(true);
      expect(msg.poll).toBeUndefined();
    }
    await loginAs(w.second.id);
    const v = await vote(p.id, [p.options[1]!]);
    expect(v.status).toBe(403);
    expect(v.text).toContain("chat.e.deleted");
    await loginAs(w.member.id);
    expect((await close(p.id)).text).toContain("chat.e.deleted");
  });
});
