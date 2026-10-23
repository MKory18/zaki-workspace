import { describe, expect, it } from "vitest";
import { readArchive } from "@/server/chat/archive";
import { makeTeam } from "./helpers";
import { db } from "./helpers";

describe("chat archive person and date filters", () => {
  it("filters message events by author and event-time range, moderation by actor/target, and omits person-agnostic closures", async () => {
    const team = await makeTeam();
    const space = await db.workspace.create({
      data: { organizationId: team.org.id, name: "Archive space", slug: `archive-${Date.now()}` },
    });
    const topic = await db.conversation.create({
      data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "Archive topic" },
    });
    const before = new Date("2026-01-02T00:00:00.000Z");
    const onFrom = new Date("2026-01-03T00:00:00.000Z");
    const inside = new Date("2026-01-04T12:00:00.000Z");
    const afterTo = new Date("2026-01-06T00:00:00.000Z");
    const deleted = await db.chatMessage.create({ data: { orgId: team.org.id, conversationId: topic.id, authorId: team.member.id, body: "deleted in range", deletedAt: inside, deletedById: team.owner.id } });
    await db.chatMessage.create({ data: { orgId: team.org.id, conversationId: topic.id, authorId: team.admin.id, body: "wrong person", deletedAt: inside, deletedById: team.owner.id } });
    await db.chatMessage.create({ data: { orgId: team.org.id, conversationId: topic.id, authorId: team.member.id, body: "too early", deletedAt: before, deletedById: team.owner.id } });
    await db.chatMessage.create({ data: { orgId: team.org.id, conversationId: topic.id, authorId: team.member.id, body: "too late", deletedAt: afterTo, deletedById: team.owner.id } });
    const edited = await db.chatMessage.create({ data: { orgId: team.org.id, conversationId: topic.id, authorId: team.member.id, body: "edited", editedAt: onFrom } });
    await db.messageRevision.create({ data: { messageId: edited.id, body: "old", editorId: team.member.id, createdAt: onFrom } });
    const inRangeAudit = await db.auditLog.create({ data: { orgId: team.org.id, action: "chat.member_muted", actorId: team.admin.id, target: team.member.id, workspaceId: space.id, conversationId: topic.id, createdAt: inside } });
    await db.auditLog.create({ data: { orgId: team.org.id, action: "chat.member_muted", actorId: team.owner.id, target: team.admin.id, workspaceId: space.id, conversationId: topic.id, createdAt: inside } });
    await db.conversation.update({ where: { id: topic.id }, data: { closedAt: inside } });
    const outsideTopic = await db.conversation.create({
      data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "Outside date archive topic", closedAt: afterTo },
    });
    const closedGroup = await db.conversation.create({
      data: { orgId: team.org.id, kind: "GROUP", title: "Closed group, not a topic", closedAt: inside },
    });

    const result = await readArchive({ orgId: team.org.id, userId: team.owner.id } as never, {
      personId: team.member.id,
      spaceId: space.id,
      from: "2026-01-03",
      to: "2026-01-05",
    });

    expect(result.items.map((item) => item.id)).toEqual(expect.arrayContaining([deleted.id, edited.id, inRangeAudit.id]));
    expect(result.items.map((item) => item.type)).not.toContain("closed");
    expect(result.items.map((item) => item.id)).not.toContain("too early");
    expect(result.items.map((item) => item.id)).not.toContain("too late");
    expect(result.items).toHaveLength(3);

    const dateFiltered = await readArchive({ orgId: team.org.id, userId: team.owner.id } as never, {
      from: "2026-01-03",
      to: "2026-01-05",
    });
    const closedIds = dateFiltered.items.filter((item) => item.type === "closed").map((item) => item.id);
    expect(closedIds).toEqual([topic.id]);
    expect(closedIds).not.toContain(outsideTopic.id);
    expect(closedIds).not.toContain(closedGroup.id);
  });
});
