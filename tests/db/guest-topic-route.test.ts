import { describe, expect, it } from "vitest";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

describe("guest access to allowed topic conversations", () => {
  it("lets a space guest read an ordinary topic and mark it read", async () => {
    const team = await makeTeam();
    const space = await makeWorkspace(team.org.id, [
      { userId: team.owner.id, role: "ADMIN" },
      { userId: team.guest.id, role: "MEMBER" },
    ]);
    const topic = await db.conversation.create({
      data: {
        orgId: team.org.id,
        spaceId: space.id,
        kind: "TOPIC",
        title: "Ordinary topic",
        topicType: "DISCUSSION",
        postingPolicy: "ALL",
        members: { create: [{ userId: team.owner.id }, { userId: team.guest.id }] },
      },
    });
    await db.chatMessage.create({
      data: { orgId: team.org.id, conversationId: topic.id, authorId: team.owner.id, body: "Topic message" },
    });

    await loginAs(team.guest.id);
    const detail = await call(conversationRoute.GET, { params: { id: topic.id } });
    expect(detail.status).toBe(200);
    expect(detail.text).toContain("Topic message");

    const marked = await call(conversationRoute.POST, { params: { id: topic.id } });
    expect(marked.status).toBe(200);
    const membership = await db.conversationMember.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: topic.id, userId: team.guest.id } },
    });
    expect(membership.lastReadAt).not.toBeNull();
  });
});
