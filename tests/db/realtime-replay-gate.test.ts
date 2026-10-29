/**
 * SSE replay (GET /api/rt with `last-event-id`) runs every replayed row through `filterVisible`
 * (src/server/realtime/hub.ts), which asks `canReadConversation` — the REAL policy module over the database,
 * not a stub. A person who reconnects must not receive the events of a conversation they cannot open: that
 * would hand back in the replay exactly what the live stream refuses to send.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { filterVisible } from "@/server/realtime/hub";
import { setPolicyStubs } from "@/server/realtime/policy-gate";

beforeEach(() => {
  // the real policy/conversation.ts answers; a stub left by another suite would weaken this test
  setPolicyStubs({});
});

/** A topic of a space the member is in, and a DM between two other people of the same company. */
async function world() {
  const team = await makeTeam();
  const colleague = await makeUser({ orgId: team.org.id });
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `R ${uid()}`);
  const topic = await db.conversation.create({
    data: { orgId: team.org.id, kind: "TOPIC", spaceId: ws.id, title: `Topic ${uid()}` },
  });
  const dm = await db.conversation.create({
    data: {
      orgId: team.org.id,
      kind: "DM",
      dmKey: [team.owner.id, colleague.id].sort().join("|"),
    },
  });
  await db.conversationMember.createMany({
    data: [
      { conversationId: topic.id, userId: team.member.id },
      { conversationId: dm.id, userId: team.owner.id },
      { conversationId: dm.id, userId: colleague.id },
    ],
  });
  return { team, colleague, ws, topic, dm };
}

const row = (id: string, ids: Record<string, string>) => ({ id, kind: "message.created", ids });

describe("SSE replay: only the events the reconnecting person may read", () => {
  it("keeps the topic of their space, drops a DM between two colleagues and an event aimed at somebody else", async () => {
    const w = await world();
    const visible = await filterVisible(w.team.member.id, [
      row("1", { conversationId: w.topic.id, messageId: "m-topic" }),
      row("2", { conversationId: w.dm.id, messageId: "m-dm" }),
      row("3", { targetUserId: w.colleague.id, messageId: "m-theirs" }),
      row("4", { targetUserId: w.team.member.id, messageId: "m-mine" }),
    ]);
    expect(visible.map((r) => r.id)).toEqual(["1", "4"]);
  });

  it("drops a topic the person has been taken out of, without caching the earlier answer", async () => {
    const w = await world();
    const before = await filterVisible(w.team.member.id, [row("1", { conversationId: w.topic.id })]);
    expect(before.map((r) => r.id)).toEqual(["1"]);

    await db.conversationMember.deleteMany({ where: { conversationId: w.topic.id, userId: w.team.member.id } });
    await db.conversation.update({ where: { id: w.topic.id }, data: { restricted: true } });

    const after = await filterVisible(w.team.member.id, [row("2", { conversationId: w.topic.id })]);
    expect(after).toEqual([]);
  });

  it("a suspended person gets nothing back, even for the topic they were in", async () => {
    const w = await world();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.team.org.id, userId: w.team.member.id } },
      data: { status: "SUSPENDED" },
    });
    const visible = await filterVisible(w.team.member.id, [row("1", { conversationId: w.topic.id })]);
    expect(visible).toEqual([]);
  });

  it("another company's conversation is never readable, whatever the rank there", async () => {
    const w = await world();
    const other = await makeTeam();
    const foreign = await db.conversation.create({
      data: { orgId: other.org.id, kind: "TOPIC", spaceId: (await makeWorkspace(other.org.id, [{ userId: other.member.id }])).id },
    });
    await db.conversationMember.create({ data: { conversationId: foreign.id, userId: other.member.id } });
    const visible = await filterVisible(w.team.member.id, [row("1", { conversationId: foreign.id })]);
    expect(visible).toEqual([]);
  });
});
