import { describe, expect, it } from "vitest";
import * as boardRoute from "@/app/api/chat/conversations/[id]/whiteboard/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const el = (id: string, version: number, extra: Record<string, unknown> = {}) => ({ id, version, versionNonce: 1, type: "rectangle", x: 0, y: 0, ...extra });

async function world() {
  const t = await makeTeam();
  const other = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Other" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }, { userId: t.guest.id, role: "GUEST" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  return { ...t, other, ws, topic };
}

const read = (id: string) => call(boardRoute.GET, { params: { id } });
const draw = (id: string, elements: unknown[]) => call(boardRoute.PUT, { method: "PUT", params: { id }, body: { elements } });

describe("the whiteboard of a conversation", () => {
  it("is empty before anybody drew, and what one person draws the others see", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect((await read(w.topic.id)).json).toMatchObject({ elements: [], version: 0, canDraw: true });
    expect((await draw(w.topic.id, [el("a", 1)])).json).toEqual({ version: 1 });

    await loginAs(w.admin.id);
    const seen = await read(w.topic.id);
    expect(seen.json).toMatchObject({ version: 1, elements: [{ id: "a", version: 1 }] });
    expect(await db.realtimeEvent.count({ where: { kind: "whiteboard.changed", ids: { path: ["conversationId"], equals: w.topic.id } } })).toBe(1);
  });

  it("two people drawing: each one's strokes stay, and an older copy never wipes a newer one", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await draw(w.topic.id, [el("a", 3, { x: 30 })]);
    await loginAs(w.admin.id);
    await draw(w.topic.id, [el("a", 2, { x: 99 }), el("b", 1)]);
    const board = (await read(w.topic.id)).json as { elements: { id: string; x: number }[]; version: number };
    expect(board.version).toBe(2);
    expect(board.elements.map((e) => [e.id, e.x])).toEqual([["a", 30], ["b", 0]]);
  });

  it("somebody who may not read the conversation sees no board and draws on none", async () => {
    const w = await world();
    await loginAs(w.other.id); // in the company, not in the space
    expect((await read(w.topic.id)).status).toBe(404);
    expect((await draw(w.topic.id, [el("a", 1)])).status).toBe(404);
    const foreign = await makeTeam();
    await loginAs(foreign.owner.id);
    expect((await read(w.topic.id)).status).toBe(404);
  });

  it("drawing follows writing: a muted person and a guest in announcements look but do not draw", async () => {
    const w = await world();
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.member.id } }, data: { mutedUntil: new Date(Date.now() + 3600_000) } });
    await loginAs(w.member.id);
    expect((await read(w.topic.id)).json).toMatchObject({ canDraw: false });
    const refused = await draw(w.topic.id, [el("a", 1)]);
    expect(refused.status).toBe(403);
    expect(refused.text).toContain("whiteboard.e.cannot_draw");

    const news = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "News", topicType: "ANNOUNCEMENTS" } });
    await loginAs(w.guest.id);
    expect((await read(news.id)).json).toMatchObject({ canDraw: false });
    expect((await draw(news.id, [el("a", 1)])).status).toBe(403);
  });

  it("the owner looks silently, and draws only where he has joined", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await draw(w.topic.id, [el("a", 1)]);
    await loginAs(w.owner.id);
    expect((await read(w.topic.id)).json).toMatchObject({ canDraw: false, version: 1 });
    expect((await draw(w.topic.id, [el("b", 1)])).status).toBe(403);
  });

  it("a DM's board is its two people's", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.admin.id } })).json?.["id"] as string;
    expect((await draw(dm, [el("a", 1)])).status).toBe(200);
    await loginAs(w.guest.id);
    expect((await read(dm)).status).toBe(404);
  });

  it("pictures are not kept, and a board too big is refused", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await draw(w.topic.id, [el("a", 1), el("p", 1, { type: "image", fileId: "x" })]);
    const board = (await read(w.topic.id)).json as { elements: { id: string }[] };
    expect(board.elements.map((e) => e.id)).toEqual(["a"]);
    const huge = Array.from({ length: 5001 }, (_, i) => el(`e${i}`, 1));
    expect((await draw(w.topic.id, huge)).status).toBe(422);
  });

  it("a board of few but enormous elements stops growing: the count is not the size", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const fat = (id: string) => el(id, 1, { text: "x".repeat(2 * 1024 * 1024) });
    // each save is under the 4 MB ceiling of ONE save; together they would pass any element count
    expect((await draw(w.topic.id, [fat("a")])).status).toBe(200);
    const refused = await draw(w.topic.id, [fat("b")]);
    expect(refused.status).toBe(422);
    expect(refused.text).toContain("whiteboard.e.too_big");
    const board = (await read(w.topic.id)).json as { elements: { id: string }[]; version: number };
    expect(board.elements.map((e) => e.id)).toEqual(["a"]);
    expect(board.version).toBe(1);
  });
});
