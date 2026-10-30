import { describe, expect, it } from "vitest";
import * as cardsRoute from "@/app/api/cards/route";
import * as cardRoute from "@/app/api/cards/[id]/route";
import * as restoreRoute from "@/app/api/cards/[id]/restore/route";
import * as duplicateRoute from "@/app/api/cards/[id]/duplicate/route";
import * as moveRoute from "@/app/api/cards/[id]/move/route";
import * as sendRoute from "@/app/api/cards/[id]/send/route";
import * as taskRoute from "@/app/api/cards/[id]/task/route";
import * as topicsRoute from "@/app/api/cards/topics/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { call, db, loginAs, makeOrg, makeProject, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * «اللوحات»: the cards of a space. Authorization is proven against a real database: a person outside the space gets
 * 404, an external partner reads and never writes (and never sees a file card), the owner reads silently and alone
 * reads the archive, nothing is ever deleted, a move writes one row, a card is sent and turned into work inside its own
 * space only.
 */

interface Card {
  id: string;
  kind: string;
  title: string;
  pinned: boolean;
  position: number;
  archivedAt: string | null;
  category: string | null;
  tags: string[];
}
type List = { cards: Card[]; canWrite: boolean; owner: boolean };

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(
    orgId,
    [{ userId: team.member.id }, { userId: team.guest.id, role: "GUEST" }, { userId: team.admin.id }],
    `Cards ${uid()}`,
  );
  const other = await makeWorkspace(orgId, [{ userId: outsider.id }], `Other ${uid()}`);
  return { ...team, outsider, space, other };
}

const list = async (spaceId: string, archived = false) =>
  call(cardsRoute.GET, { url: `http://localhost/api/cards?spaceId=${spaceId}${archived ? "&archived=1" : ""}` });
const titles = async (spaceId: string) => ((await list(spaceId)).json as unknown as List).cards.map((c) => c.title);
const make = async (spaceId: string, body: Record<string, unknown>) => call(cardsRoute.POST, { body: { spaceId, ...body } });
const note = async (spaceId: string, title: string, extra: Record<string, unknown> = {}) => {
  const res = await make(spaceId, { kind: "NOTE", title, body: `${title} text`, ...extra });
  expect(res.status).toBe(201);
  return (res.json as unknown as { card: Card }).card;
};
const idOf = (id: string) => ({ params: { id } });

describe("a space's cards belong to the people in it", () => {
  it("a member reads and writes; a person outside the space gets 404, never 403; every query carries the space", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const mine = await note(w.space.id, "member card");
    expect(await titles(w.space.id)).toEqual(["member card"]);

    await loginAs(w.outsider.id);
    expect((await list(w.space.id)).status).toBe(404);
    expect((await make(w.space.id, { kind: "NOTE", title: "sneaky" })).status).toBe(404);
    expect((await call(cardRoute.GET, idOf(mine.id))).status).toBe(404);
    expect((await call(cardRoute.PATCH, { method: "PATCH", ...idOf(mine.id), body: { title: "mine now" } })).status).toBe(404);
    expect((await call(cardRoute.DELETE, { method: "DELETE", ...idOf(mine.id) })).status).toBe(404);
    expect((await call(duplicateRoute.POST, idOf(mine.id))).status).toBe(404);
    expect((await call(topicsRoute.GET, { url: `http://localhost/api/cards/topics?spaceId=${w.space.id}` })).status).toBe(404);
    // the card is untouched
    expect(await db.card.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ title: "member card", archivedAt: null });
    // and the other space is theirs, with its own (empty) cards
    expect(await titles(w.other.id)).toEqual([]);
  });

  it("another company's owner sees nothing of this company's cards (404)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const mine = await note(w.space.id, "ours");
    const rival = await makeOrg();
    const rivalOwner = await makeUser({ orgId: rival.id, role: "OWNER" });
    await loginAs(rivalOwner.id);
    expect((await list(w.space.id)).status).toBe(404);
    expect((await call(cardRoute.GET, idOf(mine.id))).status).toBe(404);
  });

  it("an admin who is not in a space does not inherit it", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await note(w.space.id, "x");
    const strayAdmin = await makeUser({ orgId: w.org.id, role: "ADMIN" });
    await loginAs(strayAdmin.id);
    expect((await list(w.space.id)).status).toBe(404);
  });

  it("an external partner reads the cards and never writes; a file card is never shown to them", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const readable = await note(w.space.id, "for everybody");
    const file = await db.storedFile.create({
      data: { orgId: w.org.id, uploaderId: w.member.id, familyId: "f", name: "plan.png", path: `${w.org.id}/plan.png`, mimeType: "image/png", size: 10, workspaceId: w.space.id },
    });
    const fileCard = await make(w.space.id, { kind: "FILE", title: "the plan", fileId: file.id });
    expect(fileCard.status).toBe(201);

    await loginAs(w.guest.id);
    const seen = (await list(w.space.id)).json as unknown as List;
    expect(seen.canWrite).toBe(false);
    expect(seen.cards.map((c) => c.title)).toEqual(["for everybody"]);
    expect((await make(w.space.id, { kind: "NOTE", title: "guest note" })).status).toBe(403);
    expect((await call(cardRoute.PATCH, { method: "PATCH", ...idOf(readable.id), body: { pinned: true } })).status).toBe(403);
    expect((await call(cardRoute.DELETE, { method: "DELETE", ...idOf(readable.id) })).status).toBe(403);
    expect((await call(moveRoute.POST, { ...idOf(readable.id), body: {} })).status).toBe(403);
    expect((await call(duplicateRoute.POST, idOf(readable.id))).status).toBe(403);
    // the file card does not exist for them
    const fid = (fileCard.json as unknown as { card: Card }).card.id;
    expect((await call(cardRoute.GET, idOf(fid))).status).toBe(404);
    expect(await db.card.count({ where: { workspaceId: w.space.id, archivedAt: null } })).toBe(2);
  });

  it("a member whose library box is switched off does not see file cards either", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const file = await db.storedFile.create({
      data: { orgId: w.org.id, uploaderId: w.member.id, familyId: "f", name: "a.png", path: `${w.org.id}/a.png`, mimeType: "image/png", size: 10, workspaceId: w.space.id },
    });
    expect((await make(w.space.id, { kind: "FILE", title: "doc", fileId: file.id })).status).toBe(201);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { revokedCapabilities: ["files.view"] },
    });
    await loginAs(w.member.id);
    expect(await titles(w.space.id)).toEqual([]);
  });

  it("the owner reads every space without being in it, and leaves no trace", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await note(w.space.id, "private to the space");
    await loginAs(w.owner.id);
    const seen = (await list(w.space.id)).json as unknown as List;
    expect(seen.cards.map((c) => c.title)).toEqual(["private to the space"]);
    expect(seen.owner).toBe(true);
    expect(await db.workspaceMember.count({ where: { workspaceId: w.space.id, userId: w.owner.id } })).toBe(0);
  });
});

describe("«حذف» archives; nothing is ever deleted", () => {
  it("the card leaves the list, stays in the table, and only the owner reads the archive and brings it back", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const card = await note(w.space.id, "to delete");
    expect((await call(cardRoute.DELETE, { method: "DELETE", ...idOf(card.id) })).status).toBe(200);

    const row = await db.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.archivedAt).not.toBeNull();
    expect(await titles(w.space.id)).toEqual([]);
    // a member neither reads the archive nor opens the card nor changes it
    expect((await list(w.space.id, true)).status).toBe(403);
    expect((await call(cardRoute.GET, idOf(card.id))).status).toBe(404);
    expect((await call(cardRoute.PATCH, { method: "PATCH", ...idOf(card.id), body: { title: "x" } })).status).toBe(404);
    expect((await call(restoreRoute.POST, idOf(card.id))).status).toBe(404);

    await loginAs(w.owner.id);
    const archive = (await list(w.space.id, true)).json as unknown as List;
    expect(archive.cards.map((c) => c.title)).toEqual(["to delete"]);
    expect((await call(restoreRoute.POST, idOf(card.id))).status).toBe(200);
    expect(await titles(w.space.id)).toEqual(["to delete"]);
    expect((await db.card.findUniqueOrThrow({ where: { id: card.id } })).archivedAt).toBeNull();
  });

  it("no route removes a row: the count only ever goes up", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = await note(w.space.id, "a");
    await call(cardRoute.DELETE, { method: "DELETE", ...idOf(a.id) });
    await call(cardRoute.DELETE, { method: "DELETE", ...idOf(a.id) });
    expect(await db.card.count({ where: { workspaceId: w.space.id } })).toBe(1);
  });
});

describe("order: pinned first, one row per move, and the order is kept", () => {
  it("pinned cards float first in the list whatever their position", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await note(w.space.id, "first made");
    await note(w.space.id, "second made");
    const third = await note(w.space.id, "third made");
    // the newest card is on top of the manual order
    expect(await titles(w.space.id)).toEqual(["third made", "second made", "first made"]);
    const oldest = (await db.card.findFirstOrThrow({ where: { title: "first made", workspaceId: w.space.id } })).id;
    await call(cardRoute.PATCH, { method: "PATCH", ...idOf(oldest), body: { pinned: true } });
    expect(await titles(w.space.id)).toEqual(["first made", "third made", "second made"]);
    await call(cardRoute.PATCH, { method: "PATCH", ...idOf(third.id), body: { pinned: true } });
    expect(await titles(w.space.id)).toEqual(["third made", "first made", "second made"]);
  });

  it("a move writes ONE row, puts the card between its neighbours, and survives a reload", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const cards: Card[] = [];
    for (const name of ["e", "d", "c", "b", "a"]) cards.push(await note(w.space.id, name));
    // top to bottom: a b c d e
    expect(await titles(w.space.id)).toEqual(["a", "b", "c", "d", "e"]);
    const before = await db.card.findMany({ where: { workspaceId: w.space.id } });
    const [a, b, , , e] = [...cards].reverse();

    // «e» goes between «a» and «b»
    const res = await call(moveRoute.POST, { ...idOf(e!.id), body: { previousId: a!.id, nextId: b!.id } });
    expect(res.status).toBe(200);
    expect(await titles(w.space.id)).toEqual(["a", "e", "b", "c", "d"]);

    const after = await db.card.findMany({ where: { workspaceId: w.space.id } });
    const changed = after.filter((row) => {
      const was = before.find((x) => x.id === row.id)!;
      return was.position !== row.position || was.updatedAt.getTime() !== row.updatedAt.getTime();
    });
    expect(changed.map((r) => r.title)).toEqual(["e"]);
  });

  it("to the very top and the very bottom", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const c = await note(w.space.id, "c");
    const b = await note(w.space.id, "b");
    const a = await note(w.space.id, "a");
    await call(moveRoute.POST, { ...idOf(a.id), body: { previousId: c.id, nextId: null } });
    expect(await titles(w.space.id)).toEqual(["b", "c", "a"]);
    await call(moveRoute.POST, { ...idOf(a.id), body: { previousId: null, nextId: b.id } });
    expect(await titles(w.space.id)).toEqual(["a", "b", "c"]);
  });

  it("two cards with the same number are separated by one renumbering, and the move still lands", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const x = await note(w.space.id, "x");
    const y = await note(w.space.id, "y");
    const z = await note(w.space.id, "z");
    await db.card.updateMany({ where: { id: { in: [x.id, y.id] } }, data: { position: 500 } });
    await db.card.update({ where: { id: z.id }, data: { position: 100 } });
    const res = await call(moveRoute.POST, { ...idOf(z.id), body: { previousId: [x.id, y.id].sort()[0]!, nextId: [x.id, y.id].sort()[1]! } });
    expect(res.status).toBe(200);
    const order = await titles(w.space.id);
    const tied = [x, y].sort((p, q) => (p.id < q.id ? -1 : 1)).map((c) => c.title);
    expect(order).toEqual([tied[0], "z", tied[1]]);
  });

  it("a neighbour from another space, or from the archive, is refused; a card cannot be its own neighbour", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = await note(w.space.id, "a");
    const gone = await note(w.space.id, "gone");
    await call(cardRoute.DELETE, { method: "DELETE", ...idOf(gone.id) });
    expect((await call(moveRoute.POST, { ...idOf(a.id), body: { previousId: gone.id } })).status).toBe(404);
    expect((await call(moveRoute.POST, { ...idOf(a.id), body: { previousId: a.id } })).status).toBe(422);
    // a card of another space of the same company
    await db.workspaceMember.create({ data: { workspaceId: w.other.id, userId: w.member.id, role: "MEMBER" } });
    const foreign = await note(w.other.id, "foreign");
    expect((await call(moveRoute.POST, { ...idOf(a.id), body: { nextId: foreign.id } })).status).toBe(404);
  });
});

describe("what a card may carry", () => {
  it("a link is https only: no javascript:, no data:, no http:, no password in the address", async () => {
    const w = await world();
    await loginAs(w.member.id);
    for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "http://example.com", "ftp://example.com", "https://user:pw@example.com", "not a url", ""]) {
      const res = await make(w.space.id, { kind: "LINK", title: "l", data: { url: bad } });
      expect(res.status, bad).toBe(422);
    }
    const ok = await make(w.space.id, { kind: "LINK", title: "docs", data: { url: "https://example.com/a?b=1" } });
    expect(ok.status).toBe(201);
    // an edit is checked the same way
    const id = (ok.json as unknown as { card: Card }).card.id;
    expect((await call(cardRoute.PATCH, { method: "PATCH", ...idOf(id), body: { data: { url: "javascript:alert(1)" } } })).status).toBe(422);
    expect((await db.card.findUniqueOrThrow({ where: { id } })).data).toEqual({ url: "https://example.com/a?b=1" });
  });

  it("a row damaged in the database never reaches the screen as a link", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const ok = await make(w.space.id, { kind: "LINK", title: "docs", data: { url: "https://example.com" } });
    const id = (ok.json as unknown as { card: Card }).card.id;
    await db.card.update({ where: { id }, data: { data: { url: "javascript:alert(1)" } } });
    const read = (await call(cardRoute.GET, idOf(id))).json as unknown as { card: { data: unknown } };
    expect(read.card.data).toBeNull();
  });

  it("a list, a table and a prompt keep their shape; a prompt needs its text", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const list1 = await make(w.space.id, { kind: "LIST", title: "to buy", data: { items: [{ text: " milk ", done: false }, { text: "", done: true }, { text: "tea", done: true }] } });
    expect(list1.status).toBe(201);
    expect((list1.json as unknown as { card: { data: unknown } }).card.data).toEqual({ items: [{ text: "milk", done: false }, { text: "tea", done: true }] });
    const table = await make(w.space.id, { kind: "TABLE", title: "specs", data: { columns: ["a", "b"], rows: [["1"], ["2", "3"]] } });
    expect(table.status).toBe(201);
    expect((table.json as unknown as { card: { data: unknown } }).card.data).toEqual({ columns: ["a", "b"], rows: [["1", ""], ["2", "3"]] });
    expect((await make(w.space.id, { kind: "TABLE", title: "wide", data: { columns: Array(9).fill("c"), rows: [] } })).status).toBe(422);
    expect((await make(w.space.id, { kind: "PROMPT", title: "p" })).status).toBe(422);
    expect((await make(w.space.id, { kind: "PROMPT", title: "p", body: "write a poem" })).status).toBe(201);
    expect((await make(w.space.id, { kind: "NOTE", title: "   " })).status).toBe(422);
    expect((await make(w.space.id, { kind: "NOTE", title: "c", color: "#ff0000" })).status).toBe(422);
  });

  it("category and tags are cleaned; a card is duplicated right after the original, unpinned", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const card = await note(w.space.id, "orig", { category: "  ideas  ", tags: ["#a", "a", " b ", ""], pinned: true });
    expect(card.category).toBe("ideas");
    expect(card.tags).toEqual(["a", "b"]);
    const other = await note(w.space.id, "other");
    const dup = await call(duplicateRoute.POST, idOf(card.id));
    expect(dup.status).toBe(201);
    const copy = (dup.json as unknown as { card: Card }).card;
    expect(copy.pinned).toBe(false);
    expect(copy.id).not.toBe(card.id);
    // pinned original first, then the others by position: the copy sits right after the original in manual order
    const order = await titles(w.space.id);
    expect(order[0]).toBe("orig");
    expect(order.indexOf(copy.title)).toBeGreaterThan(-1);
    const rows = await db.card.findMany({ where: { workspaceId: w.space.id, archivedAt: null }, orderBy: [{ position: "asc" }] });
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(copy.id)).toBe(ids.indexOf(card.id) + 1);
    void other;
  });

  it("a file card points at a finished library file of the SAME space, no other", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await db.workspaceMember.create({ data: { workspaceId: w.other.id, userId: w.member.id, role: "MEMBER" } });
    const mk = (workspaceId: string | null, over: Record<string, unknown> = {}) =>
      db.storedFile.create({
        data: { orgId: w.org.id, uploaderId: w.member.id, familyId: "f", name: "a.pdf", path: `${w.org.id}/a.pdf`, mimeType: "application/pdf", size: 3, workspaceId, ...over },
      });
    const mine = await mk(w.space.id);
    const elsewhere = await mk(w.other.id);
    const chatFile = await mk(null, { purpose: "CHAT" });
    const pending = await mk(w.space.id, { path: "pending" });
    const deleted = await mk(w.space.id, { deletedAt: new Date() });
    expect((await make(w.space.id, { kind: "FILE", title: "ok", fileId: mine.id })).status).toBe(201);
    for (const f of [elsewhere, chatFile, pending, deleted]) {
      expect((await make(w.space.id, { kind: "FILE", title: "no", fileId: f.id })).status).toBe(404);
    }
    expect((await make(w.space.id, { kind: "FILE", title: "no file" })).status).toBe(422);
    // and the file's own bytes remain the files service's business: the card stores no bytes
    expect(await db.storedFile.count({ where: { orgId: w.org.id } })).toBe(5);
  });
});

describe("«أرسل»: a card goes into a topic of its own space", () => {
  async function topic(w: Awaited<ReturnType<typeof world>>, spaceId: string, title: string) {
    return db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title, spaceId } });
  }

  it("the title and the words arrive as a message of the member, through the chat's own path", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const card = await make(w.space.id, { kind: "LIST", title: "shopping", body: "for the party", data: { items: [{ text: "milk", done: true }, { text: "tea", done: false }] } });
    const id = (card.json as unknown as { card: Card }).card.id;
    const conv = await topic(w, w.space.id, "general");
    const offered = (await call(topicsRoute.GET, { url: `http://localhost/api/cards/topics?spaceId=${w.space.id}` })).json as unknown as { topics: Array<{ id: string }> };
    expect(offered.topics.map((t) => t.id)).toEqual([conv.id]);

    const res = await call(sendRoute.POST, { ...idOf(id), body: { conversationId: conv.id } });
    expect(res.status).toBe(201);
    const msg = await db.chatMessage.findUniqueOrThrow({ where: { id: (res.json as unknown as { messageId: string }).messageId } });
    expect(msg).toMatchObject({ conversationId: conv.id, authorId: w.member.id, orgId: w.org.id });
    expect(msg.body).toBe("shopping\nfor the party\n☑ milk\n☐ tea");
  });

  it("a topic of ANOTHER space, a DM, a closed topic, a topic of another company: nothing is sent", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const card = await note(w.space.id, "hello");
    await db.workspaceMember.create({ data: { workspaceId: w.other.id, userId: w.member.id, role: "MEMBER" } });
    const elsewhere = await topic(w, w.other.id, "elsewhere");
    const dm = await db.conversation.create({ data: { orgId: w.org.id, kind: "DM", dmKey: `${w.member.id}|${w.admin.id}`, spaceId: w.space.id } });
    const closed = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "closed", spaceId: w.space.id, closedAt: new Date() } });
    const rival = await makeOrg();
    const rivalOwner = await makeUser({ orgId: rival.id, role: "OWNER" });
    const rivalSpace = await makeWorkspace(rival.id, [{ userId: rivalOwner.id }]);
    const foreign = await db.conversation.create({ data: { orgId: rival.id, kind: "TOPIC", title: "foreign", spaceId: rivalSpace.id } });

    expect((await call(sendRoute.POST, { ...idOf(card.id), body: { conversationId: elsewhere.id } })).status).toBe(404);
    expect((await call(sendRoute.POST, { ...idOf(card.id), body: { conversationId: dm.id } })).status).toBe(404);
    expect((await call(sendRoute.POST, { ...idOf(card.id), body: { conversationId: closed.id } })).status).toBe(403);
    expect((await call(sendRoute.POST, { ...idOf(card.id), body: { conversationId: foreign.id } })).status).toBe(404);
    expect(await db.chatMessage.count({ where: { orgId: { in: [w.org.id, rival.id] }, kind: "TEXT" } })).toBe(0);
    // an external partner cannot send a card at all
    const conv = await topic(w, w.space.id, "open");
    await loginAs(w.guest.id);
    expect((await call(sendRoute.POST, { ...idOf(card.id), body: { conversationId: conv.id } })).status).toBe(403);
  });

  it("a file card sends its words only, never the file", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const file = await db.storedFile.create({
      data: { orgId: w.org.id, uploaderId: w.member.id, familyId: "f", name: "secret.pdf", path: `${w.org.id}/secret.pdf`, mimeType: "application/pdf", size: 3, workspaceId: w.space.id },
    });
    const made = await make(w.space.id, { kind: "FILE", title: "the contract", fileId: file.id });
    const id = (made.json as unknown as { card: Card }).card.id;
    const conv = await topic(w, w.space.id, "general");
    const res = await call(sendRoute.POST, { ...idOf(id), body: { conversationId: conv.id } });
    expect(res.status).toBe(201);
    const msgId = (res.json as unknown as { messageId: string }).messageId;
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: msgId } })).body).toBe("the contract");
    expect(await db.messageAttachment.count({ where: { messageId: msgId } })).toBe(0);
  });
});

describe("«حوّلها لمهمة»", () => {
  it("makes a task through the task service, in a project of the card's own space", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const { project, board } = await makeProject(w.space.id);
    const card = await make(w.space.id, { kind: "LIST", title: "launch checklist", body: "before friday", data: { items: [{ text: "banner", done: false }] } });
    const id = (card.json as unknown as { card: Card }).card.id;
    const res = await call(taskRoute.POST, { ...idOf(id), body: { projectId: project.id, boardId: board.id } });
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: (res.json as unknown as { taskId: string }).taskId } });
    expect(task).toMatchObject({ title: "launch checklist", workspaceId: w.space.id, projectId: project.id, creatorId: w.member.id, orgId: w.org.id });
    expect(task.description).toBe("before friday\n☐ banner");
  });

  it("a project of another space is refused, and so is a guest", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const elsewhere = await makeProject(w.other.id);
    const mine = await makeProject(w.space.id);
    const card = await note(w.space.id, "x");
    expect((await call(taskRoute.POST, { ...idOf(card.id), body: { projectId: elsewhere.project.id, boardId: elsewhere.board.id } })).status).toBe(404);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
    await loginAs(w.guest.id);
    expect((await call(taskRoute.POST, { ...idOf(card.id), body: { projectId: mine.project.id, boardId: mine.board.id } })).status).toBe(403);
  });
});

describe("the space type", () => {
  it("every space is STANDARD unless it was made as a space of cards", async () => {
    const w = await world();
    expect((await db.workspace.findUniqueOrThrow({ where: { id: w.space.id } })).layout).toBe("STANDARD");
    await loginAs(w.owner.id);
    const made = await call(workspacesRoute.POST, { body: { name: "Boards", layout: "CARDS" } });
    expect(made.status).toBe(201);
    const created = (made.json as unknown as { workspace: { id: string } }).workspace.id;
    expect(await db.workspace.findUniqueOrThrow({ where: { id: created }, select: { layout: true, kind: true } })).toEqual({ layout: "CARDS", kind: "STANDARD" });
    const plain = await call(workspacesRoute.POST, { body: { name: "Plain" } });
    expect((await db.workspace.findUniqueOrThrow({ where: { id: (plain.json as unknown as { workspace: { id: string } }).workspace.id } })).layout).toBe("STANDARD");
    const factory = await call(workspacesRoute.POST, { body: { name: "Factory", layout: "MANUFACTURING" } });
    expect(factory.status).toBe(201);
    expect((await db.workspace.findUniqueOrThrow({ where: { id: (factory.json as unknown as { workspace: { id: string } }).workspace.id } })).layout).toBe("MANUFACTURING");
    expect((await call(workspacesRoute.POST, { body: { name: "Odd", layout: "BOARDS" } })).status).toBe(422);
  });
});
