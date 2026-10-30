import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

import { MessageItem } from "../src/components/chat/message/message-item";
import { PollCard } from "../src/components/chat/message/poll-card";
import { menuFor, type MessageMenuContext } from "../src/components/chat/message/message-menu-registry";
import { cleanPollOptions, pollCreateData, pollInputSchema, pollIsClosed, presentPoll, type PollRow, type PollViewer } from "../src/server/chat/poll-shared";
import { buildPollPayload, choiceAfterTap, emptyPollDraft, errorKeyOf, pollDraftProblem } from "../src/lib/chat/poll-client";
import { REALTIME_KINDS } from "../src/server/realtime/emit";
import { AR } from "../src/lib/i18n/dict";
import type { MessageDto, PollDto } from "../src/server/chat/dto";

const NOW = new Date("2026-10-30T12:00:00Z");
const row = (over: Partial<PollRow> = {}): PollRow => ({
  id: "p1",
  multiple: false,
  anonymous: false,
  closesAt: null,
  closedAt: null,
  options: [
    { id: "o1", text: "شاورما", votes: [{ userId: "a", user: { name: "أحمد" } }, { userId: "b", user: { name: "بسمة" } }] },
    { id: "o2", text: "برغر", votes: [{ userId: "c", user: { name: "جود" } }] },
    { id: "o3", text: "فلافل", votes: [] },
  ],
  ...over,
});
const viewer = (over: Partial<PollViewer> = {}): PollViewer => ({ userId: "x", role: "MEMBER", isMember: true, canModerateHere: false, ...over });

describe("poll options", () => {
  it("2 to 10 distinct, trimmed options of at most 100 characters; blanks are dropped", () => {
    expect(cleanPollOptions([" أ ", "ب"])).toEqual(["أ", "ب"]);
    expect(cleanPollOptions(["أ", "  ", "ب"])).toEqual(["أ", "ب"]);
    expect(cleanPollOptions(["أ"])).toBeNull();
    expect(cleanPollOptions(["أ", "أ"])).toBeNull();
    expect(cleanPollOptions(["أ", "ب   ج", "ب ج"])).toBeNull();
    expect(cleanPollOptions(["أ", "ب".repeat(101)])).toBeNull();
    expect(cleanPollOptions(["أ", "ب".repeat(100)])).not.toBeNull();
    expect(cleanPollOptions(Array.from({ length: 10 }, (_, i) => `خ${i}`))).toHaveLength(10);
    expect(cleanPollOptions(Array.from({ length: 11 }, (_, i) => `خ${i}`))).toBeNull();
  });

  it("the deadline is at most 7 days", () => {
    expect(pollInputSchema.safeParse({ options: ["أ", "ب"], closesInMinutes: 7 * 24 * 60 }).success).toBe(true);
    expect(pollInputSchema.safeParse({ options: ["أ", "ب"], closesInMinutes: 7 * 24 * 60 + 1 }).success).toBe(false);
    expect(pollInputSchema.safeParse({ options: ["أ", "ب"], closesInMinutes: 0 }).success).toBe(false);
    expect(pollInputSchema.safeParse({ options: ["أ", "ب"], closesInMinutes: 1.5 }).success).toBe(false);
    const data = pollCreateData({ options: ["أ", "ب"], closesInMinutes: 90, multiple: true }, ["أ", "ب"], NOW);
    expect(data.closesAt).toEqual(new Date(NOW.getTime() + 90 * 60_000));
    expect(data).toMatchObject({ multiple: true, anonymous: false });
  });

  it("a poll is closed by hand or by the clock", () => {
    expect(pollIsClosed({ closesAt: null, closedAt: null }, NOW)).toBe(false);
    expect(pollIsClosed({ closesAt: null, closedAt: NOW }, NOW)).toBe(true);
    expect(pollIsClosed({ closesAt: new Date(NOW.getTime() + 1), closedAt: null }, NOW)).toBe(false);
    expect(pollIsClosed({ closesAt: NOW, closedAt: null }, NOW)).toBe(true);
  });
});

describe("what a viewer is given of a poll", () => {
  it("counts and percentages of the people who voted; my own choice marked", () => {
    const p = presentPoll(row(), viewer({ userId: "c" }), "author", false, NOW);
    expect(p.voters).toBe(3);
    expect(p.options.map((o) => [o.count, o.percent])).toEqual([[2, 67], [1, 33], [0, 0]]);
    expect(p.options.map((o) => o.mine)).toEqual([false, true, false]);
    expect(p).toMatchObject({ canVote: true, canClose: false, closed: false });
  });

  it("names of the voters on a poll that is not anonymous; never on an anonymous one", () => {
    expect(presentPoll(row(), viewer(), "author", false).options[0]!.voters).toEqual([{ id: "a", name: "أحمد" }, { id: "b", name: "بسمة" }]);
    const secret = presentPoll(row({ anonymous: true }), viewer({ role: "OWNER", canModerateHere: true }), "x", false);
    expect(JSON.stringify(secret)).not.toMatch(/أحمد|بسمة|جود/);
    expect(JSON.stringify(secret)).not.toContain('"a"');
    expect(secret.options.map((o) => o.count)).toEqual([2, 1, 0]);
  });

  it("a guest sees the counts but no names, and cannot vote or close", () => {
    const p = presentPoll(row(), viewer({ role: "GUEST" }), "x", false);
    expect(p.options.every((o) => o.voters === undefined)).toBe(true);
    expect(p).toMatchObject({ voters: 3, canVote: false, canClose: false });
  });

  it("the owner in silent oversight sees it but neither votes nor closes; once he joined he does", () => {
    expect(presentPoll(row(), viewer({ role: "OWNER", isMember: false, canModerateHere: true }), "x", false)).toMatchObject({ canVote: false, canClose: false });
    expect(presentPoll(row(), viewer({ role: "OWNER", isMember: true, canModerateHere: true }), "x", false)).toMatchObject({ canVote: true, canClose: true });
  });

  it("the creator or a moderator closes; nobody closes a closed poll; a closed or deleted one takes no vote", () => {
    expect(presentPoll(row(), viewer({ userId: "author" }), "author", false).canClose).toBe(true);
    expect(presentPoll(row(), viewer({ canModerateHere: true }), "author", false).canClose).toBe(true);
    const closed = presentPoll(row({ closedAt: NOW }), viewer({ userId: "author" }), "author", false, NOW);
    expect(closed).toMatchObject({ closed: true, canClose: false, canVote: false });
    expect(presentPoll(row(), viewer(), "author", true)).toMatchObject({ canVote: false, canClose: false });
  });

  it("nobody voted yet: zero percent, not NaN", () => {
    const p = presentPoll(row({ options: [{ id: "o1", text: "أ", votes: [] }, { id: "o2", text: "ب", votes: [] }] }), viewer(), "x", false);
    expect(p.options.map((o) => o.percent)).toEqual([0, 0]);
    expect(p.voters).toBe(0);
  });
});

describe("the poll screens' logic", () => {
  const poll = (multiple: boolean, mine: string[]): Pick<PollDto, "multiple" | "options"> => ({
    multiple,
    options: ["o1", "o2", "o3"].map((id) => ({ id, text: id, count: 0, percent: 0, mine: mine.includes(id) })),
  });

  it("a tap on a single-choice poll replaces my vote, a second tap on it withdraws it", () => {
    expect(choiceAfterTap(poll(false, []), "o1")).toEqual(["o1"]);
    expect(choiceAfterTap(poll(false, ["o1"]), "o2")).toEqual(["o2"]);
    expect(choiceAfterTap(poll(false, ["o1"]), "o1")).toEqual([]);
  });

  it("a tap on a multiple-choice poll toggles that option", () => {
    expect(choiceAfterTap(poll(true, ["o1"]), "o2")).toEqual(["o1", "o2"]);
    expect(choiceAfterTap(poll(true, ["o1", "o2"]), "o1")).toEqual(["o2"]);
  });

  it("the dialog's draft follows the server's rules and builds the send request", () => {
    const draft = { ...emptyPollDraft(), question: "  سؤال؟ ", options: [" أ ", "", "ب"] };
    expect(pollDraftProblem(emptyPollDraft())).toBe("question");
    expect(pollDraftProblem({ ...draft, options: ["أ", ""] })).toBe("options");
    expect(pollDraftProblem({ ...draft, options: ["أ", "أ"] })).toBe("duplicate");
    expect(pollDraftProblem(draft)).toBeNull();
    expect(buildPollPayload(draft, "c1")).toEqual({ body: "سؤال؟", clientId: "c1", poll: { options: ["أ", "ب"] } });
    expect(buildPollPayload({ ...draft, multiple: true, anonymous: true, closesInMinutes: 1440 }, "c1").poll).toEqual({ options: ["أ", "ب"], multiple: true, anonymous: true, closesInMinutes: 1440 });
  });

  it("an error answer yields its machine key, from the message or from the details", () => {
    expect(errorKeyOf({ error: "forbidden", message: "chat.e.poll_closed" })).toBe("chat.e.poll_closed");
    expect(errorKeyOf({ error: "validation.failed", message: "validation.failed", details: [{ path: "poll.options", message: "chat.e.poll_options" }] })).toBe("chat.e.poll_options");
    expect(errorKeyOf({ error: "internal" })).toBeNull();
    expect(errorKeyOf(null)).toBeNull();
  });

  it("every error key the poll can answer with has an Arabic sentence", () => {
    for (const key of ["poll_topic_only", "poll_guest", "poll_alone", "poll_question", "poll_options", "poll_immutable", "poll_closed", "poll_bad_option", "poll_single", "poll_close_denied"]) {
      expect(AR[`chat.e.${key}`], key).toBeTruthy();
    }
  });

  it("the event of a vote is a kind the browsers know", () => {
    expect(REALTIME_KINDS).toContain("poll.voted");
  });
});

describe("the poll in the message log", () => {
  const pollDto: PollDto = {
    id: "p1",
    multiple: false,
    anonymous: false,
    closesAt: null,
    closed: false,
    voters: 3,
    canVote: true,
    canClose: true,
    options: [
      { id: "o1", text: "شاورما", count: 2, percent: 67, mine: true, voters: [{ id: "a", name: "أحمد" }, { id: "b", name: "بسمة" }] },
      { id: "o2", text: "برغر", count: 1, percent: 33, mine: false, voters: [{ id: "c", name: "جود" }] },
    ],
  };
  const message: MessageDto = { id: "m1", kind: "POLL", body: "وين نتغدى؟", deleted: false, edited: false, pinned: false, mine: false, authorId: "u2", authorName: "ليلى", createdAt: "2026-10-30T10:00:00Z", mentions: [], attachments: [], reactions: [], poll: pollDto };
  const noop = () => undefined;
  const render = (m: MessageDto, extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(MessageItem, { message: m, canModerate: false, onReact: noop, onAction: noop, ...extra }));

  it("the question, then the card: options with counts and percentages, who chose what, the count of voters", () => {
    const html = render(message);
    expect(html).toContain("وين نتغدى؟");
    expect(html).toContain("data-poll");
    expect(html).toContain("شاورما");
    expect(html).toContain("67%");
    expect(html).toContain("من اختاره: أحمد، بسمة");
    expect(html).toContain("صوّت 3 أشخاص");
    expect(html).toContain('role="radio"');
    expect(html).toContain("إغلاق الاستطلاع");
    expect(html).toContain("سحب صوتي");
  });

  it("an anonymous poll says so and lists nobody", () => {
    const html = render({ ...message, poll: { ...pollDto, anonymous: true, options: pollDto.options.map(({ voters: _v, ...o }) => o) } });
    expect(html).toContain("data-poll-anonymous");
    expect(html).not.toContain("data-poll-voters");
  });

  it("a closed poll, a guest and the silent owner see disabled options and no close button", () => {
    const html = renderToStaticMarkup(React.createElement(PollCard, { messageId: "m1", poll: { ...pollDto, closed: true, canVote: false, canClose: false } }));
    expect(html).toContain('data-closed="true"');
    expect(html).toContain("مغلق");
    expect(html).not.toContain("إغلاق الاستطلاع");
    expect(html).not.toContain("سحب صوتي");
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("a deleted poll shows only the tombstone", () => {
    const html = render({ ...message, deleted: true, body: null, poll: undefined });
    expect(html).not.toContain("data-poll");
  });

  it("a multiple-choice poll offers checkboxes", () => {
    expect(render({ ...message, poll: { ...pollDto, multiple: true } })).toContain('role="checkbox"');
  });

  it("the message menu never offers «تحويل» or «تعديل» on a poll", () => {
    const context: MessageMenuContext = { mine: true, deleted: false, kind: "POLL", hasText: true, pinned: false, conversationKind: "TOPIC", canPost: true, canModerate: true, oversight: false };
    const ids = menuFor(context).map((a) => a.id);
    expect(ids).not.toContain("forward");
    expect(ids).not.toContain("edit");
    expect(ids).toContain("delete");
    expect(menuFor({ ...context, kind: "TEXT" }).map((a) => a.id)).toContain("forward");
  });
});
