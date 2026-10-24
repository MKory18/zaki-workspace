import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

describe("the answer to sending a message", () => {
  it("a DM message of mine comes back at ✓ (sent): the screen shows it from this answer, before any refetch", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const sent = await call(messagesRoute.POST, { params: { id: dm }, body: { body: "مرحبا" } });
    expect(sent.status).toBe(201);
    expect(sent.json?.["status"]).toBe("sent");
  });

  it("a topic message has no ticks (readers' avatars are a topic's receipts)", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }]);
    const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
    await loginAs(t.member.id);
    const sent = await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: "hi" } });
    expect(sent.json?.["status"]).toBeUndefined();
  });
});
