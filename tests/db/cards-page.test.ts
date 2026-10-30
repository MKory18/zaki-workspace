import "./scoping-react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import * as cardsRoute from "@/app/api/cards/route";
import * as cardRoute from "@/app/api/cards/[id]/route";
import * as pageRoute from "@/app/api/cards/[id]/page/route";
import * as notesRoute from "@/app/api/cards/[id]/notes/route";
import * as noteRoute from "@/app/api/cards/[id]/notes/[noteId]/route";
import * as ratingRoute from "@/app/api/cards/[id]/rating/route";
import * as statusRoute from "@/app/api/cards/[id]/status/route";
import * as revisionsRoute from "@/app/api/cards/[id]/revisions/route";
import * as revisionRestoreRoute from "@/app/api/cards/[id]/revisions/[version]/restore/route";
import * as logRoute from "@/app/api/cards/[id]/log/route";
import * as linksRoute from "@/app/api/cards/[id]/links/route";
import * as attachmentsRoute from "@/app/api/cards/[id]/attachments/route";
import * as orderRoute from "@/app/api/cards/[id]/attachments/order/route";
import * as attachmentRoute from "@/app/api/cards/[id]/attachments/[attachmentId]/route";
import * as coverRoute from "@/app/api/cards/[id]/cover/route";
import * as sendRoute from "@/app/api/cards/[id]/send/route";
import * as taskRoute from "@/app/api/cards/[id]/task/route";
import * as undeleteRoute from "@/app/api/cards/[id]/restore/route";
import CardPageRoute from "@/app/(app)/cards/[id]/page";
import { ingest } from "@/server/services/files";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * The page inside a card, proven against a real database: versions and the 409, restore, the two rating systems, the
 * notes (public and private), the gallery, the log and the links. Who may read and write is decided by the server on
 * every request; a person outside the space gets 404, an external partner reads the card and nothing internal, the owner
 * reads silently, and a private note is private to its author even from the owner.
 */

interface Card {
  id: string;
  title: string;
  body: string | null;
  version: number;
  status: string;
  pinned: boolean;
  tags: string[];
  category: string | null;
  createdById: string;
}
type Json = Record<string, unknown>;

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const member2 = await makeUser({ orgId, role: "MEMBER", name: "Member Two" });
  const spaceAdmin = await makeUser({ orgId, role: "MEMBER", name: "Space Admin" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(
    orgId,
    [
      { userId: team.member.id },
      { userId: member2.id },
      { userId: spaceAdmin.id, role: "ADMIN" },
      { userId: team.admin.id },
      { userId: team.guest.id, role: "GUEST" },
    ],
    `Page ${uid()}`,
  );
  const other = await makeWorkspace(orgId, [{ userId: team.member.id }], `Other ${uid()}`);
  return { ...team, member2, spaceAdmin, outsider, space, other };
}
type World = Awaited<ReturnType<typeof world>>;
type Person = { id: string };

const idOf = (id: string, extra: Record<string, string> = {}) => ({ params: { id, ...extra } });
const as = async (who: Person) => loginAs(who.id);

/** A card made by `who` (the member by default), at version 1. */
async function newCard(w: World, who: Person = w.member, extra: Json = {}): Promise<Card> {
  await as(who);
  const res = await call(cardsRoute.POST, { body: { spaceId: w.space.id, kind: "NOTE", title: "Original", body: "first words", ...extra } });
  expect(res.status).toBe(201);
  return (res.json as unknown as { card: Card }).card;
}

const patch = (id: string, body: Json) => call(cardRoute.PATCH, { method: "PATCH", ...idOf(id), body });
const cardOf = (res: { json: Json | null }) => (res.json as unknown as { card: Card }).card;
const row = (id: string) => db.card.findUniqueOrThrow({ where: { id } });
const revisions = (id: string) => db.cardRevision.findMany({ where: { cardId: id }, orderBy: { version: "asc" } });

/** Every read a person can make about a card, as one text (to prove a thing is nowhere in it). */
async function everythingSeenBy(who: Person, id: string): Promise<string> {
  await as(who);
  const reads = await Promise.all([pageRoute.GET, notesRoute.GET, ratingRoute.GET, revisionsRoute.GET, logRoute.GET, linksRoute.GET, attachmentsRoute.GET].map((h) => call(h, idOf(id))));
  return reads.map((r) => r.text).join("\n");
}

const file = (w: World, over: Json = {}) =>
  db.storedFile.create({
    data: {
      orgId: w.org.id,
      uploaderId: w.member.id,
      familyId: "f",
      name: `${uid()}.png`,
      path: `${w.org.id}/${uid()}.png`,
      mimeType: "image/png",
      size: 10,
      workspaceId: w.space.id,
      ...over,
    },
  });

// ───────────────────────────── versions ─────────────────────────────

describe("every save is a version", () => {
  it("a save from the version the editor started at bumps the card and appends what it was BEFORE", async () => {
    const w = await world();
    const card = await newCard(w);
    expect(card).toMatchObject({ version: 1, status: "DRAFT" });

    const second = await patch(card.id, { title: "Second", version: 1 });
    expect(second.status).toBe(200);
    expect(cardOf(second)).toMatchObject({ title: "Second", version: 2 });
    const third = await patch(card.id, { body: "later words", tags: ["x"], version: 2 });
    expect(cardOf(third)).toMatchObject({ title: "Second", version: 3 });

    const history = await revisions(card.id);
    expect(history.map((r) => [r.version, r.title, r.body, r.editorId])).toEqual([
      [1, "Original", "first words", w.member.id],
      [2, "Second", "first words", w.member.id],
    ]);
    expect(history[1]!.tags).toEqual([]);
  });

  it("a stale save is refused with 409 and the card as it is now; nothing is written", async () => {
    const w = await world();
    const card = await newCard(w);
    // two people open the card at version 1; the first saves
    await as(w.member2);
    expect(cardOf(await patch(card.id, { title: "Colleague's title", version: 1 }))).toMatchObject({ version: 2 });

    await as(w.member);
    const late = await patch(card.id, { title: "Late title", body: "late words", version: 1 });
    expect(late.status).toBe(409);
    expect(late.json).toMatchObject({ error: "conflict", message: "cards.conflict" });
    expect((late.json as unknown as { card: Card }).card).toMatchObject({ title: "Colleague's title", version: 2, body: "first words" });
    expect(await row(card.id)).toMatchObject({ title: "Colleague's title", body: "first words", version: 2 });
    expect((await revisions(card.id)).map((r) => r.version)).toEqual([1]);

    // taking the current version consciously goes through
    expect(cardOf(await patch(card.id, { title: "Late title", version: 2 }))).toMatchObject({ title: "Late title", version: 3 });
  });

  it("two saves from the same version at once: exactly one wins, the other is a 409", async () => {
    const w = await world();
    const card = await newCard(w);
    const results = await Promise.all([patch(card.id, { title: "A", version: 1 }), patch(card.id, { title: "B", version: 1 })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await row(card.id)).version).toBe(2);
    expect((await revisions(card.id)).map((r) => r.version)).toEqual([1]);
  });

  it("a save that changes nothing, and a pin, write no version and no revision", async () => {
    const w = await world();
    const card = await newCard(w);
    expect(cardOf(await patch(card.id, { title: "Original", body: "first words", version: 1 }))).toMatchObject({ version: 1 });
    // an identical save from an old version is not a conflict either: there is nothing to overwrite
    await patch(card.id, { title: "Moved", version: 1 });
    expect((await patch(card.id, { title: "Moved", version: 1 })).status).toBe(200);
    const pinned = await patch(card.id, { pinned: true });
    expect(cardOf(pinned)).toMatchObject({ pinned: true, version: 2 });
    expect((await revisions(card.id)).map((r) => r.version)).toEqual([1]);
  });

  it("the editor's null file on a note (it always sends one) is ignored, not refused", async () => {
    const w = await world();
    const card = await newCard(w);
    const res = await patch(card.id, { title: "Edited", fileId: null, pinned: false, version: 1 });
    expect(res.status).toBe(200);
    expect(cardOf(res).title).toBe("Edited");
  });

  it("an older client that sends no version still saves (and is still versioned)", async () => {
    const w = await world();
    const card = await newCard(w);
    expect(cardOf(await patch(card.id, { title: "No version sent" }))).toMatchObject({ version: 2 });
    expect((await revisions(card.id)).map((r) => r.title)).toEqual(["Original"]);
  });
});

describe("restoring an old version", () => {
  async function history(w: World) {
    const card = await newCard(w, w.member, { title: "one" });
    await patch(card.id, { title: "two", version: 1 });
    await patch(card.id, { title: "three", version: 2 });
    return card;
  }

  it("writes a NEW revision and a new version; the old revisions are untouched", async () => {
    const w = await world();
    const card = await history(w);
    const before = await revisions(card.id);
    expect(before.map((r) => r.title)).toEqual(["one", "two"]);

    await as(w.member2);
    const res = await call(revisionRestoreRoute.POST, { ...idOf(card.id, { version: "1" }), body: { version: 3 } });
    expect(res.status).toBe(200);
    expect(cardOf(res)).toMatchObject({ title: "one", version: 4 });

    const after = await revisions(card.id);
    expect(after.map((r) => [r.version, r.title])).toEqual([[1, "one"], [2, "two"], [3, "three"]]);
    // the earlier rows are byte for byte what they were
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2]!.editorId).toBe(w.member2.id);
  });

  it("is itself a version that can be restored again (history is never rewritten)", async () => {
    const w = await world();
    const card = await history(w);
    await call(revisionRestoreRoute.POST, { ...idOf(card.id, { version: "1" }), body: {} });
    const again = await call(revisionRestoreRoute.POST, { ...idOf(card.id, { version: "3" }), body: {} });
    expect(cardOf(again)).toMatchObject({ title: "three", version: 5 });
    expect((await revisions(card.id)).map((r) => r.title)).toEqual(["one", "two", "three", "one"]);
  });

  it("a stale restore is a 409 like a stale edit; a version that does not exist is 404; a guest cannot restore", async () => {
    const w = await world();
    const card = await history(w);
    const stale = await call(revisionRestoreRoute.POST, { ...idOf(card.id, { version: "1" }), body: { version: 1 } });
    expect(stale.status).toBe(409);
    expect((await call(revisionRestoreRoute.POST, { ...idOf(card.id, { version: "99" }), body: {} })).status).toBe(404);
    expect((await call(revisionRestoreRoute.POST, { ...idOf(card.id, { version: "x" }), body: {} })).status).toBe(422);
    expect((await row(card.id)).version).toBe(3);
    await as(w.guest);
    expect((await call(revisionRestoreRoute.POST, { ...idOf(card.id, { version: "1" }), body: {} })).status).toBe(403);
    await as(w.outsider);
    expect((await call(revisionRestoreRoute.POST, { ...idOf(card.id, { version: "1" }), body: {} })).status).toBe(404);
  });

  it("another card's revision is not reachable through this card", async () => {
    const w = await world();
    const mine = await history(w);
    const theirs = await newCard(w, w.member, { title: "other card" });
    await patch(theirs.id, { title: "other card 2", version: 1 });
    await as(w.member);
    // version 1 of `theirs` is «other card»; asking `mine` for version 1 gives mine
    const res = await call(revisionRestoreRoute.POST, { ...idOf(mine.id, { version: "1" }), body: {} });
    expect(cardOf(res).title).toBe("one");
    expect((await row(theirs.id)).title).toBe("other card 2");
  });

  it("revisions are append-only: the database refuses to change one, and the list is read only", async () => {
    const w = await world();
    const card = await history(w);
    const [first] = await revisions(card.id);
    await expect(db.cardRevision.update({ where: { id: first!.id }, data: { title: "rewritten" } })).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "CardRevision" SET "title" = 'x' WHERE "id" = ${first!.id}`).rejects.toThrow();
    expect((await revisions(card.id))[0]!.title).toBe("one");

    const list = (await call(revisionsRoute.GET, idOf(card.id))).json as unknown as { currentVersion: number; revisions: Array<{ version: number; title: string; editorName: string }> };
    expect(list.currentVersion).toBe(3);
    expect(list.revisions.map((r) => r.version)).toEqual([2, 1]); // newest first
    expect(list.revisions[0]).toMatchObject({ title: "two", editorName: "Member" });
    for (const method of ["PATCH", "PUT", "DELETE"]) expect((revisionsRoute as Record<string, unknown>)[method], method).toBeUndefined();
  });
});

// ───────────────────────────── who may edit ─────────────────────────────

describe("who may edit and read the page", () => {
  it("a member edits ANY card of the space; a guest cannot; a person outside the space gets 404", async () => {
    const w = await world();
    const card = await newCard(w, w.admin);
    await as(w.member2);
    expect((await patch(card.id, { title: "edited by another member", version: 1 })).status).toBe(200);

    await as(w.guest);
    expect((await patch(card.id, { title: "guest edit", version: 2 })).status).toBe(403);
    await as(w.outsider);
    expect((await patch(card.id, { title: "outsider edit", version: 2 })).status).toBe(404);
    for (const h of [pageRoute.GET, notesRoute.GET, ratingRoute.GET, revisionsRoute.GET, logRoute.GET, linksRoute.GET, attachmentsRoute.GET]) {
      expect((await call(h, idOf(card.id))).status).toBe(404);
    }
    expect(await row(card.id)).toMatchObject({ title: "edited by another member", version: 2 });
  });

  it("another company's owner gets 404 for every part of the page", async () => {
    const w = await world();
    const card = await newCard(w);
    const rival = await makeTeam();
    await as(rival.owner);
    for (const h of [pageRoute.GET, notesRoute.GET, ratingRoute.GET, revisionsRoute.GET, logRoute.GET, linksRoute.GET, attachmentsRoute.GET]) {
      expect((await call(h, idOf(card.id))).status).toBe(404);
    }
  });

  it("an external partner reads the card and nothing internal: no stars, no notes, no versions, no log, no links, no gallery", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member);
    await call(ratingRoute.PUT, { method: "PUT", ...idOf(card.id), body: { stars: 5 } });
    await call(notesRoute.POST, { ...idOf(card.id), body: { body: "team talk" } });

    await as(w.guest);
    const page = (await call(pageRoute.GET, idOf(card.id))).json as unknown as { card: Card; abilities: Json; rating: unknown; gallery: unknown[] };
    expect(page.card.id).toBe(card.id);
    expect(page.abilities).toMatchObject({ internal: false, write: false, participate: false, moderate: false, gallery: false, seeRaters: false });
    expect(page.rating).toBeNull();
    expect(page.gallery).toEqual([]);
    for (const h of [notesRoute.GET, ratingRoute.GET, revisionsRoute.GET, logRoute.GET, linksRoute.GET]) {
      const res = await call(h, idOf(card.id));
      if (h === ratingRoute.GET) expect(res.json).toEqual({ rating: null });
      else expect(res.status, String(h)).toBe(403);
    }
    expect((await call(ratingRoute.PUT, { method: "PUT", ...idOf(card.id), body: { stars: 1 } })).status).toBe(403);
    expect((await call(notesRoute.POST, { ...idOf(card.id), body: { body: "guest note" } })).status).toBe(403);
    expect((await call(statusRoute.PUT, { method: "PUT", ...idOf(card.id), body: { status: "REVIEW" } })).status).toBe(403);
    expect(await db.cardNote.count({ where: { cardId: card.id } })).toBe(1);
    expect(await db.cardRating.count({ where: { cardId: card.id } })).toBe(1);
  });

  it("deleting a card hides EVERYTHING of it from the team; only the owner still reads it, and nobody writes to it", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member);
    await call(notesRoute.POST, { ...idOf(card.id), body: { body: "a team note" } });
    await call(ratingRoute.PUT, { method: "PUT", ...idOf(card.id), body: { stars: 4 } });
    expect((await call(cardRoute.DELETE, { method: "DELETE", ...idOf(card.id) })).status).toBe(200);

    for (const who of [w.member, w.member2, w.spaceAdmin, w.admin, w.guest, w.outsider]) {
      await as(who);
      for (const h of [pageRoute.GET, notesRoute.GET, ratingRoute.GET, revisionsRoute.GET, logRoute.GET, linksRoute.GET, attachmentsRoute.GET]) {
        expect((await call(h, idOf(card.id))).status, `${who.id} ${String(h)}`).toBe(404);
      }
      expect((await call(notesRoute.POST, { ...idOf(card.id), body: { body: "late" } })).status).toBe(404);
      expect((await call(ratingRoute.PUT, { method: "PUT", ...idOf(card.id), body: { stars: 1 } })).status).toBe(404);
    }

    await as(w.owner);
    const page = (await call(pageRoute.GET, idOf(card.id))).json as unknown as { card: Card; abilities: Json };
    expect(page.card.id).toBe(card.id);
    expect(page.abilities).toMatchObject({ write: false, participate: false, moderate: false, restore: true });
    expect((await call(notesRoute.GET, idOf(card.id))).status).toBe(200);
    expect((await patch(card.id, { title: "edit a deleted card", version: 1 })).status).toBe(404);
    expect((await call(ratingRoute.PUT, { method: "PUT", ...idOf(card.id), body: { stars: 2 } })).status).toBe(404);
    expect((await call(statusRoute.PUT, { method: "PUT", ...idOf(card.id), body: { status: "REVIEW" } })).status).toBe(404);
    expect(await db.cardNote.count({ where: { cardId: card.id } })).toBe(1);

    // bringing it back opens everything again
    expect((await call(undeleteRoute.POST, idOf(card.id))).status).toBe(200);
    await as(w.member2);
    expect((await call(pageRoute.GET, idOf(card.id))).status).toBe(200);
  });

  it("the page's abilities follow the rank: member, moderator, owner in oversight, owner who joined", async () => {
    const w = await world();
    const card = await newCard(w);
    const abilities = async (who: Person) => {
      await as(who);
      return ((await call(pageRoute.GET, idOf(card.id))).json as unknown as { abilities: Json }).abilities;
    };
    expect(await abilities(w.member2)).toMatchObject({ write: true, participate: true, moderate: false, seeRaters: false, oversight: false, internal: true, statusMoves: [] });
    expect(await abilities(w.member)).toMatchObject({ seeRaters: true }); // the creator
    expect(await abilities(w.spaceAdmin)).toMatchObject({ moderate: true, statusMoves: ["REVIEW", "ARCHIVED"], seeRaters: false });
    expect(await abilities(w.admin)).toMatchObject({ moderate: true });
    expect(await abilities(w.owner)).toMatchObject({ write: true, participate: false, oversight: true, moderate: true, seeRaters: true });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: w.owner.id, role: "MEMBER" } });
    expect(await abilities(w.owner)).toMatchObject({ participate: true, oversight: false });
  });
});

// ───────────────────────────── the two rating systems ─────────────────────────────

describe("stars: one per person, changeable, the average and the count", () => {
  const rate = (id: string, stars: unknown) => call(ratingRoute.PUT, { method: "PUT", ...idOf(id), body: { stars } });
  const view = async (id: string) => ((await call(ratingRoute.GET, idOf(id))).json as unknown as { rating: { average: number | null; count: number; mine: number | null; raters: Array<{ name: string; stars: number }> | null } }).rating;

  it("each person has one row and may change it; the card shows the average and how many rated", async () => {
    const w = await world();
    const card = await newCard(w);
    expect(await view(card.id)).toMatchObject({ average: null, count: 0, mine: null });
    await as(w.member);
    expect((await rate(card.id, 5)).status).toBe(200);
    await as(w.member2);
    await rate(card.id, 4);
    await as(w.spaceAdmin);
    await rate(card.id, 4);
    expect(await view(card.id)).toMatchObject({ average: 4.3, count: 3, mine: 4 });

    // changing is an update of the same row, not a second vote
    await as(w.member2);
    await rate(card.id, 1);
    expect(await db.cardRating.count({ where: { cardId: card.id, userId: w.member2.id } })).toBe(1);
    expect(await db.cardRating.count({ where: { cardId: card.id } })).toBe(3);
    expect(await view(card.id)).toMatchObject({ average: 3.3, count: 3, mine: 1 });
  });

  it("only whole numbers from 1 to 5 are stars (the service and the database both insist)", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member);
    for (const bad of [0, 6, 2.5, -1, "3", null]) expect((await rate(card.id, bad)).status, String(bad)).toBe(422);
    await expect(db.cardRating.create({ data: { cardId: card.id, userId: w.member.id, stars: 9 } })).rejects.toThrow();
    expect(await db.cardRating.count({ where: { cardId: card.id } })).toBe(0);
  });

  it("a guest never rates; a person outside the space gets 404", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.guest);
    expect((await rate(card.id, 5)).status).toBe(403);
    await as(w.outsider);
    expect((await rate(card.id, 5)).status).toBe(404);
    expect(await db.cardRating.count({ where: { cardId: card.id } })).toBe(0);
  });

  it("the OWNER in silent oversight cannot rate and leaves no trace by reading; once he joins the space his stars count like anybody's", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member);
    await rate(card.id, 3);
    await call(notesRoute.POST, { ...idOf(card.id), body: { body: "something" } });

    const traces = async () => ({
      audits: await db.auditLog.count({ where: { OR: [{ actorId: w.owner.id }, { target: card.id }] } }),
      rows: await db.workspaceMember.count({ where: { userId: w.owner.id } }),
      ratings: await db.cardRating.count({ where: { cardId: card.id } }),
      notes: await db.cardNote.count({ where: { cardId: card.id } }),
      notices: await db.notification.count({}),
    });
    const before = await traces();
    await as(w.owner);
    for (const h of [pageRoute.GET, notesRoute.GET, ratingRoute.GET, revisionsRoute.GET, logRoute.GET, linksRoute.GET, attachmentsRoute.GET]) {
      expect((await call(h, idOf(card.id))).status, String(h)).toBe(200);
    }
    const refused = await rate(card.id, 5);
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ message: "cards.oversight_silent" });
    expect((await call(notesRoute.POST, { ...idOf(card.id), body: { body: "from the owner" } })).status).toBe(403);
    expect(await traces()).toEqual(before);

    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: w.owner.id, role: "MEMBER" } });
    await as(w.owner);
    expect((await rate(card.id, 5)).status).toBe(200);
    expect(await view(card.id)).toMatchObject({ average: 4, count: 2, mine: 5 });
  });

  it("who rated what is the OWNER's and the card creator's to see, nobody else's", async () => {
    const w = await world();
    const card = await newCard(w, w.member);
    await as(w.member);
    await rate(card.id, 5);
    await as(w.member2);
    await rate(card.id, 2);
    await as(w.spaceAdmin);
    await rate(card.id, 3);

    const named = async (who: Person) => (await as(who), (await view(card.id)).raters);
    expect(await named(w.owner)).toEqual([
      { userId: w.member.id, name: "Member", stars: 5 },
      { userId: w.member2.id, name: "Member Two", stars: 2 },
      { userId: w.spaceAdmin.id, name: "Space Admin", stars: 3 },
    ]);
    expect((await named(w.member))!.map((r) => r.stars)).toEqual([5, 2, 3]); // the creator
    for (const who of [w.member2, w.spaceAdmin, w.admin]) {
      expect(await named(who), who.id).toBeNull();
      // nowhere in anything this person can read is there a list of raters
      const seen = await everythingSeenBy(who, card.id);
      expect(seen, who.id).not.toContain('"userId"');
      expect(seen, who.id).not.toContain('"raters":[');
    }
    // the page read says the same
    await as(w.member2);
    const page = (await call(pageRoute.GET, idOf(card.id))).json as unknown as { rating: { raters: unknown; mine: number } };
    expect(page.rating).toMatchObject({ raters: null, mine: 2 });
  });
});

describe("the approval status", () => {
  const move = (id: string, status: string) => call(statusRoute.PUT, { method: "PUT", ...idOf(id), body: { status } });

  it("every card starts as a draft; a moderator (space admin, org admin in the space, owner) moves it along the road", async () => {
    const w = await world();
    const card = await newCard(w);
    expect(card.status).toBe("DRAFT");
    for (const who of [w.spaceAdmin, w.admin, w.owner]) {
      await as(who);
      expect(cardOf(await move(card.id, "REVIEW")).status, who.id).toBe("REVIEW");
      expect(cardOf(await move(card.id, "APPROVED")).status, who.id).toBe("APPROVED");
      expect(cardOf(await move(card.id, "REVIEW")).status, who.id).toBe("REVIEW");
      expect(cardOf(await move(card.id, "DRAFT")).status, who.id).toBe("DRAFT");
    }
    expect((await row(card.id)).status).toBe("DRAFT");
  });

  it("a plain member, the card's creator and a guest cannot move it; a person outside the space gets 404", async () => {
    const w = await world();
    const card = await newCard(w, w.member);
    for (const who of [w.member, w.member2, w.guest]) {
      await as(who);
      expect((await move(card.id, "REVIEW")).status, who.id).toBe(403);
    }
    await as(w.outsider);
    expect((await move(card.id, "REVIEW")).status).toBe(404);
    expect((await row(card.id)).status).toBe("DRAFT");
  });

  it("the road is kept: no jump from draft to approved, no unknown status, and a status that stays is not a move", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.spaceAdmin);
    expect((await move(card.id, "APPROVED")).status).toBe(422);
    expect((await move(card.id, "DONE")).status).toBe(422);
    expect((await move(card.id, "DRAFT")).status).toBe(200);
    expect((await row(card.id)).status).toBe("DRAFT");
    expect(await db.auditLog.count({ where: { target: card.id, action: "card.status" } })).toBe(0);
  });

  it("every move is logged with who and when, and reaches the card's log", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.spaceAdmin);
    await move(card.id, "REVIEW");
    await as(w.owner);
    await move(card.id, "APPROVED");
    const rows = await db.auditLog.findMany({ where: { target: card.id, action: "card.status" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.actorId, r.meta, r.orgId, r.workspaceId])).toEqual([
      [w.spaceAdmin.id, { from: "DRAFT", to: "REVIEW" }, w.org.id, w.space.id],
      [w.owner.id, { from: "REVIEW", to: "APPROVED" }, w.org.id, w.space.id],
    ]);
    expect(rows[0]!.createdAt.getTime()).toBeLessThanOrEqual(rows[1]!.createdAt.getTime());
    await as(w.member2);
    const log = ((await call(logRoute.GET, idOf(card.id))).json as unknown as { entries: Array<{ action: string; actorName: string; detail: Json }> }).entries;
    expect(log.filter((e) => e.action === "status").map((e) => [e.actorName, e.detail])).toEqual([
      ["Owner", { from: "REVIEW", to: "APPROVED" }],
      ["Space Admin", { from: "DRAFT", to: "REVIEW" }],
    ]);
  });

  it("is a system of its own: stars do not move it, and it does not move the stars", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member2);
    await call(ratingRoute.PUT, { method: "PUT", ...idOf(card.id), body: { stars: 5 } });
    expect((await row(card.id)).status).toBe("DRAFT");
    await as(w.spaceAdmin);
    await move(card.id, "REVIEW");
    expect(await db.cardRating.count({ where: { cardId: card.id } })).toBe(1);
  });
});

// ───────────────────────────── notes ─────────────────────────────

describe("notes: public for the space, private to their author", () => {
  const add = (id: string, body: string, visibility: "PUBLIC" | "PRIVATE" = "PUBLIC") => call(notesRoute.POST, { ...idOf(id), body: { body, visibility } });
  const read = async (id: string) =>
    (await call(notesRoute.GET, idOf(id))).json as unknown as { publicNotes: Array<{ id: string; body: string; authorName: string }> | null; privateNotes: Array<{ id: string; body: string }> };

  it("a public note is read by the members of the space, with its author", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member);
    expect((await add(card.id, "first public note")).status).toBe(201);
    await as(w.member2);
    await add(card.id, "second public note");
    for (const who of [w.member, w.member2, w.spaceAdmin, w.admin, w.owner]) {
      await as(who);
      expect((await read(card.id)).publicNotes!.map((n) => [n.body, n.authorName]), who.id).toEqual([
        ["first public note", "Member"],
        ["second public note", "Member Two"],
      ]);
    }
    await as(w.guest);
    expect((await call(notesRoute.GET, idOf(card.id))).status).toBe(403);
    await as(w.outsider);
    expect((await call(notesRoute.GET, idOf(card.id))).status).toBe(404);
  });

  it("a private note is invisible to everybody but its author: not the owner, not an admin, not a moderator, not the card's creator", async () => {
    const w = await world();
    const card = await newCard(w, w.admin);
    const secret = "TOP-SECRET-PRIVATE-WORDS";
    await as(w.member2);
    const made = await add(card.id, secret, "PRIVATE");
    expect(made.status).toBe(201);
    const noteId = (made.json as unknown as { note: { id: string } }).note.id;

    expect((await read(card.id)).privateNotes.map((n) => n.body)).toEqual([secret]);
    for (const who of [w.owner, w.admin, w.spaceAdmin, w.member, w.guest, w.outsider]) {
      const seen = await everythingSeenBy(who, card.id);
      expect(seen, who.id).not.toContain(secret);
      await as(who);
      // nor can they reach it by its id
      expect([403, 404], who.id).toContain((await call(noteRoute.PATCH, { method: "PATCH", ...idOf(card.id, { noteId }), body: { body: "x" } })).status);
      expect([403, 404], who.id).toContain((await call(noteRoute.DELETE, { method: "DELETE", ...idOf(card.id, { noteId }) })).status);
    }
    // an owner who joined the space still does not read other people's private notes
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: w.owner.id, role: "MEMBER" } });
    expect(await everythingSeenBy(w.owner, card.id)).not.toContain(secret);
    expect(await db.cardNote.findUniqueOrThrow({ where: { id: noteId } })).toMatchObject({ body: secret, deletedAt: null });
    // and a private note leaves no line in the log
    await as(w.member2);
    const log = ((await call(logRoute.GET, idOf(card.id))).json as unknown as { entries: Json[] }).entries;
    expect(JSON.stringify(log)).not.toContain(secret);
    expect(await db.auditLog.count({ where: { target: card.id, action: { contains: "note" } } })).toBe(0);
  });

  it("only the author changes a note's words", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member);
    const noteId = ((await add(card.id, "mine")).json as unknown as { note: { id: string } }).note.id;
    const edit = (body: string) => call(noteRoute.PATCH, { method: "PATCH", ...idOf(card.id, { noteId }), body: { body } });
    expect((await edit("mine, edited")).status).toBe(200);
    expect(await db.cardNote.findUniqueOrThrow({ where: { id: noteId } })).toMatchObject({ body: "mine, edited" });
    expect((await db.cardNote.findUniqueOrThrow({ where: { id: noteId } })).editedAt).not.toBeNull();
    await as(w.member2);
    expect((await edit("hijacked")).status).toBe(403);
    await as(w.spaceAdmin);
    expect((await edit("moderator edit")).status).toBe(403);
    expect((await db.cardNote.findUniqueOrThrow({ where: { id: noteId } })).body).toBe("mine, edited");
  });

  it("a deleted note keeps its row: its author deletes it, a moderator may take down a public one, nobody else", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member);
    const own = ((await add(card.id, "to delete")).json as unknown as { note: { id: string } }).note.id;
    const other = ((await add(card.id, "to moderate")).json as unknown as { note: { id: string } }).note.id;
    const del = (noteId: string) => call(noteRoute.DELETE, { method: "DELETE", ...idOf(card.id, { noteId }) });

    await as(w.member2);
    expect((await del(other)).status).toBe(403);
    await as(w.member);
    expect((await del(own)).status).toBe(200);
    expect((await del(own)).status).toBe(404); // already gone
    await as(w.spaceAdmin);
    expect((await del(other)).status).toBe(200);

    expect(await db.cardNote.count({ where: { cardId: card.id } })).toBe(2);
    const rows = await db.cardNote.findMany({ where: { cardId: card.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.body, r.deletedAt !== null, r.deletedById])).toEqual([
      ["to delete", true, w.member.id],
      ["to moderate", true, w.spaceAdmin.id],
    ]);
    await as(w.member2);
    expect((await read(card.id)).publicNotes).toEqual([]);
  });

  it("a moderator cannot take down somebody's PRIVATE note (it does not exist for them)", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member2);
    const noteId = ((await add(card.id, "mine only", "PRIVATE")).json as unknown as { note: { id: string } }).note.id;
    await as(w.spaceAdmin);
    expect((await call(noteRoute.DELETE, { method: "DELETE", ...idOf(card.id, { noteId }) })).status).toBe(404);
    expect((await db.cardNote.findUniqueOrThrow({ where: { id: noteId } })).deletedAt).toBeNull();
  });

  it("empty or over-long words are refused; a guest and the owner in oversight cannot write", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member);
    expect((await add(card.id, "   ")).status).toBe(422);
    expect((await add(card.id, "x".repeat(4001))).status).toBe(422);
    await as(w.guest);
    expect((await add(card.id, "guest")).status).toBe(403);
    await as(w.owner);
    expect((await add(card.id, "owner in oversight")).status).toBe(403);
    expect(await db.cardNote.count({ where: { cardId: card.id } })).toBe(0);
  });
});

// ───────────────────────────── the gallery ─────────────────────────────

describe("the gallery and the cover", () => {
  const attach = (id: string, fileId: string, caption?: string) => call(attachmentsRoute.POST, { ...idOf(id), body: { fileId, ...(caption ? { caption } : {}) } });
  const gallery = async (id: string) => ((await call(attachmentsRoute.GET, idOf(id))).json as unknown as { gallery: Array<{ id: string; fileId: string; caption: string | null; position: number; isCover: boolean }> }).gallery;

  it("links library pictures of this space, in order, with captions; reorder, caption and removal work; the file stays", async () => {
    const w = await world();
    const card = await newCard(w);
    const [a, b, c] = [await file(w), await file(w), await file(w)];
    await as(w.member2);
    for (const f of [a, b, c]) expect((await attach(card.id, f.id, `caption ${f.id.slice(-4)}`)).status).toBe(201);
    let g = await gallery(card.id);
    expect(g.map((x) => x.fileId)).toEqual([a.id, b.id, c.id]);
    expect(g.map((x) => x.position)).toEqual([0, 1, 2]);

    const reordered = await call(orderRoute.PUT, { method: "PUT", ...idOf(card.id), body: { ids: [g[2]!.id, g[0]!.id, g[1]!.id] } });
    expect(reordered.status).toBe(200);
    g = await gallery(card.id);
    expect(g.map((x) => x.fileId)).toEqual([c.id, a.id, b.id]);

    expect((await call(attachmentRoute.PATCH, { method: "PATCH", ...idOf(card.id, { attachmentId: g[0]!.id }), body: { caption: "new words" } })).status).toBe(200);
    expect((await gallery(card.id))[0]!.caption).toBe("new words");
    expect((await call(attachmentRoute.PATCH, { method: "PATCH", ...idOf(card.id, { attachmentId: g[0]!.id }), body: { caption: null } })).status).toBe(200);
    expect((await gallery(card.id))[0]!.caption).toBeNull();

    expect((await call(attachmentRoute.DELETE, { method: "DELETE", ...idOf(card.id, { attachmentId: g[1]!.id }) })).status).toBe(200);
    expect((await gallery(card.id)).map((x) => x.fileId)).toEqual([c.id, b.id]);
    expect(await db.storedFile.count({ where: { id: a.id, deletedAt: null } })).toBe(1);
    // a card keeps only LINKS: one small table, no second file table
    expect(await db.cardAttachment.count({ where: { cardId: card.id } })).toBe(2);
  });

  it("an order that is not exactly the card's own attachments is refused", async () => {
    const w = await world();
    const card = await newCard(w);
    const other = await newCard(w, w.member, { title: "other" });
    await as(w.member);
    const [a, b, c] = [await file(w), await file(w), await file(w)];
    await attach(card.id, a.id);
    await attach(card.id, b.id);
    await attach(other.id, c.id);
    const mine = await gallery(card.id);
    const foreign = await gallery(other.id);
    const put = (ids: string[]) => call(orderRoute.PUT, { method: "PUT", ...idOf(card.id), body: { ids } });
    expect((await put([mine[0]!.id])).status).toBe(422);
    expect((await put([mine[0]!.id, mine[0]!.id])).status).toBe(422);
    expect((await put([mine[0]!.id, foreign[0]!.id])).status).toBe(422);
    expect((await gallery(card.id)).map((x) => x.fileId)).toEqual([a.id, b.id]);
  });

  it("needs a StoredFile the editor may use: a finished, current library file of THIS space, not deleted", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.member);
    const elsewhere = await file(w, { workspaceId: w.other.id });
    const chat = await file(w, { purpose: "CHAT", workspaceId: null });
    const pending = await file(w, { path: "pending" });
    const deleted = await file(w, { deletedAt: new Date() });
    const old = await file(w, { isLatest: false });
    const rival = await makeTeam();
    const foreign = await db.storedFile.create({
      data: { orgId: rival.org.id, uploaderId: rival.member.id, familyId: "f", name: "x.png", path: `${rival.org.id}/x.png`, mimeType: "image/png", size: 1 },
    });
    for (const f of [elsewhere, chat, pending, deleted, old, foreign]) expect((await attach(card.id, f.id)).status, f.id).toBe(404);
    expect((await attach(card.id, "nonexistent")).status).toBe(404);
    expect(await db.cardAttachment.count({ where: { cardId: card.id } })).toBe(0);

    const good = await file(w);
    expect((await attach(card.id, good.id)).status).toBe(201);
    const dup = await attach(card.id, good.id);
    expect(dup.status).toBe(422);
    expect(JSON.stringify(dup.json)).toContain("cards.e.attach_dup");
    expect(await db.cardAttachment.count({ where: { cardId: card.id } })).toBe(1);
  });

  it("a card holds at most 30 attachments", async () => {
    const w = await world();
    const card = await newCard(w);
    const files = await Promise.all(Array.from({ length: 31 }, () => file(w)));
    await db.cardAttachment.createMany({ data: files.slice(0, 30).map((f, i) => ({ cardId: card.id, fileId: f.id, position: i, addedById: w.member.id })) });
    await as(w.member);
    const res = await attach(card.id, files[30]!.id);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.json)).toContain("cards.e.attach_limit");
    expect(await db.cardAttachment.count({ where: { cardId: card.id } })).toBe(30);
  });

  it("the cover is a picture (never a pdf) of this space, chosen by anybody who writes, and can be cleared", async () => {
    const w = await world();
    const card = await newCard(w);
    const pic = await file(w);
    const pdf = await file(w, { mimeType: "application/pdf", name: "a.pdf" });
    const elsewhere = await file(w, { workspaceId: w.other.id });
    const cover = (fileId: string | null) => call(coverRoute.PUT, { method: "PUT", ...idOf(card.id), body: { fileId } });
    await as(w.member2);
    expect((await cover(pdf.id)).status).toBe(422);
    expect((await cover(elsewhere.id)).status).toBe(404);
    expect((await cover(pic.id)).status).toBe(200);
    expect((await row(card.id)).coverFileId).toBe(pic.id);
    const page = (await call(pageRoute.GET, idOf(card.id))).json as unknown as { card: { coverFileId: string | null } };
    expect(page.card.coverFileId).toBe(pic.id);
    expect((await cover(null)).status).toBe(200);
    expect((await row(card.id)).coverFileId).toBeNull();
  });

  it("the gallery marks the cover; a guest cannot add and is shown none; a member without the library neither adds nor sees it", async () => {
    const w = await world();
    const card = await newCard(w);
    const pic = await file(w);
    await as(w.member);
    await attach(card.id, pic.id);
    await call(coverRoute.PUT, { method: "PUT", ...idOf(card.id), body: { fileId: pic.id } });
    expect((await gallery(card.id))[0]).toMatchObject({ fileId: pic.id, isCover: true });

    await as(w.guest);
    expect((await attach(card.id, pic.id)).status).toBe(403);
    expect((await call(coverRoute.PUT, { method: "PUT", ...idOf(card.id), body: { fileId: null } })).status).toBe(403);
    const seen = (await call(pageRoute.GET, idOf(card.id))).json as unknown as { gallery: unknown[]; card: { coverFileId: string | null } };
    expect(seen.gallery).toEqual([]);
    expect(seen.card.coverFileId).toBeNull();

    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member2.id } },
      data: { revokedCapabilities: ["files.view"] },
    });
    await as(w.member2);
    const pic2 = await file(w);
    expect((await attach(card.id, pic2.id)).status).toBe(403);
    expect((await gallery(card.id))).toEqual([]);
    const page = (await call(pageRoute.GET, idOf(card.id))).json as unknown as { card: { coverFileId: string | null }; abilities: Json };
    expect(page.card.coverFileId).toBeNull();
    expect(page.abilities).toMatchObject({ gallery: false });
  });

  it("a person outside the space gets 404; a deleted card takes nothing", async () => {
    const w = await world();
    const card = await newCard(w);
    const pic = await file(w);
    await as(w.outsider);
    expect((await attach(card.id, pic.id)).status).toBe(404);
    await as(w.member);
    await call(cardRoute.DELETE, { method: "DELETE", ...idOf(card.id) });
    expect((await attach(card.id, pic.id)).status).toBe(404);
  });

  it("pictures are sniffed and limited by the existing upload service: the name says nothing, the bytes do", async () => {
    const w = await world();
    const card = await newCard(w);
    const ctx = { orgId: w.org.id, orgRole: "MEMBER" as const, userId: w.member.id };
    const place = { workspaceId: w.space.id };
    // text called .png is stored as what its bytes are (text), so it is never a cover
    const text = await ingest(ctx, { name: "photo.png", bytes: new TextEncoder().encode("this is plain text, not a picture") }, undefined, "LIBRARY", undefined, place);
    expect(text.mimeType).toBe("text/plain");
    await as(w.member);
    expect((await call(coverRoute.PUT, { method: "PUT", ...idOf(card.id), body: { fileId: text.id } })).status).toBe(422);
    // real picture bytes are a picture, and may be the cover
    const png = await ingest(ctx, { name: "x.bin", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]) }, undefined, "LIBRARY", undefined, place);
    expect(png.mimeType).toBe("image/png");
    expect((await call(coverRoute.PUT, { method: "PUT", ...idOf(card.id), body: { fileId: png.id } })).status).toBe(200);

    // bytes of no known type, an empty file and an oversize one never become a row, so they cannot be attached
    const before = await db.storedFile.count({ where: { orgId: w.org.id } });
    await expect(ingest(ctx, { name: "blob.png", bytes: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) }, undefined, "LIBRARY", undefined, place)).rejects.toThrow("files.unsupported");
    await expect(ingest(ctx, { name: "empty.png", bytes: new Uint8Array() }, undefined, "LIBRARY", undefined, place)).rejects.toThrow("files.empty");
    await expect(
      ingest(ctx, { name: "big.png", path: "never-read.png", size: 26 * 1024 * 1024, prefix: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }, undefined, "LIBRARY", undefined, place),
    ).rejects.toThrow("files.too_large");
    // the external partner cannot put anything into the library at all
    await expect(ingest({ ...ctx, orgRole: "GUEST", userId: w.guest.id }, { name: "g.png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) }, undefined, "LIBRARY", undefined, place)).rejects.toThrow();
    expect(await db.storedFile.count({ where: { orgId: w.org.id } })).toBe(before);
  });
});

// ───────────────────────────── the log and the links ─────────────────────────────

describe("the log", () => {
  const entries = async (who: Person, id: string) => {
    await as(who);
    const res = await call(logRoute.GET, idOf(id));
    expect(res.status).toBe(200);
    return (res.json as unknown as { entries: Array<{ action: string; actorName: string | null; at: string; detail: Json }> }).entries;
  };

  it("tells what happened, in order: created, edited, restored, pinned, status, picture added and removed, cover, sent, task, rated", async () => {
    const w = await world();
    const card = await newCard(w, w.member, { title: "one" });
    await patch(card.id, { title: "two", version: 1 });
    await patch(card.id, { pinned: true });
    await call(revisionRestoreRoute.POST, { ...idOf(card.id, { version: "1" }), body: {} });
    const pic = await file(w, { name: "banner.png" });
    const added = await call(attachmentsRoute.POST, { ...idOf(card.id), body: { fileId: pic.id } });
    const attachmentId = (added.json as unknown as { gallery: Array<{ id: string }> }).gallery[0]!.id;
    await call(coverRoute.PUT, { method: "PUT", ...idOf(card.id), body: { fileId: pic.id } });
    await call(attachmentRoute.DELETE, { method: "DELETE", ...idOf(card.id, { attachmentId }) });
    await call(ratingRoute.PUT, { method: "PUT", ...idOf(card.id), body: { stars: 4 } });
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "general", spaceId: w.space.id } });
    await call(sendRoute.POST, { ...idOf(card.id), body: { conversationId: topic.id } });
    const { project, board } = await makeProject(w.space.id);
    await call(taskRoute.POST, { ...idOf(card.id), body: { projectId: project.id, boardId: board.id } });
    await as(w.spaceAdmin);
    await call(statusRoute.PUT, { method: "PUT", ...idOf(card.id), body: { status: "REVIEW" } });

    const log = await entries(w.member2, card.id);
    const actions = log.map((e) => e.action);
    expect(actions.reverse()).toEqual(["created", "edited", "pinned", "restored", "image_added", "cover", "image_removed", "rated", "sent", "task", "status"]);
    const byAction = (a: string) => log.find((e) => e.action === a)!;
    expect(byAction("edited")).toMatchObject({ actorName: "Member", detail: { version: 2, fields: "title" } });
    expect(byAction("restored").detail).toEqual({ fromVersion: 1, version: 3 });
    expect(byAction("image_added").detail).toEqual({ name: "banner.png" });
    expect(byAction("status")).toMatchObject({ actorName: "Space Admin", detail: { from: "DRAFT", to: "REVIEW" } });
    // newest first, and every line has its time
    const times = (await entries(w.member2, card.id)).map((e) => Date.parse(e.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("never exposes who rated what to a plain member: the line is anonymous and carries no stars", async () => {
    const w = await world();
    const card = await newCard(w, w.member);
    await as(w.member2);
    await call(ratingRoute.PUT, { method: "PUT", ...idOf(card.id), body: { stars: 1 } });
    await call(ratingRoute.PUT, { method: "PUT", ...idOf(card.id), body: { stars: 2 } });

    for (const who of [w.member2, w.spaceAdmin, w.admin]) {
      const rated = (await entries(who, card.id)).filter((e) => e.action === "rated");
      expect(rated.map((e) => e.actorName), who.id).toEqual([null, null]);
      expect(JSON.stringify(await entries(who, card.id)), who.id).not.toMatch(/stars/i);
    }
    // the card's creator and the owner may know whose it was, still without the number
    for (const who of [w.member, w.owner]) {
      const rated = (await entries(who, card.id)).filter((e) => e.action === "rated");
      expect(rated.map((e) => e.actorName), who.id).toEqual(["Member Two", "Member Two"]);
      expect(JSON.stringify(await entries(who, card.id)), who.id).not.toMatch(/stars/i);
    }
    // and nothing in the audit row says it either
    const raw = await db.auditLog.findMany({ where: { target: card.id, action: "card.rated" } });
    expect(JSON.stringify(raw.map((r) => r.meta))).not.toMatch(/stars|[0-9]/);
  });

  it("a card from before the log still begins with its creation", async () => {
    const w = await world();
    const old = await db.card.create({ data: { orgId: w.org.id, workspaceId: w.space.id, createdById: w.admin.id, kind: "NOTE", title: "legacy", body: "x" } });
    const log = await entries(w.member, old.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "created", actorName: "Admin" });
  });

  it("only the team reads it; the owner reads it silently", async () => {
    const w = await world();
    const card = await newCard(w);
    await as(w.guest);
    expect((await call(logRoute.GET, idOf(card.id))).status).toBe(403);
    const before = await db.auditLog.count({ where: { target: card.id } });
    await entries(w.owner, card.id);
    expect(await db.auditLog.count({ where: { target: card.id } })).toBe(before);
  });
});

describe("what the card became", () => {
  it("lists the task made from it and the topic it was sent to, each only to a person who may open it", async () => {
    const w = await world();
    const card = await newCard(w);
    const open = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "open topic", spaceId: w.space.id } });
    const closed = await db.conversation.create({
      data: { orgId: w.org.id, kind: "TOPIC", title: "closed topic", spaceId: w.space.id, restricted: true, members: { create: [{ userId: w.member.id }] } },
    });
    const { project, board } = await makeProject(w.space.id);
    await as(w.member);
    const sentOpen = await call(sendRoute.POST, { ...idOf(card.id), body: { conversationId: open.id } });
    const sentClosed = await call(sendRoute.POST, { ...idOf(card.id), body: { conversationId: closed.id } });
    expect([sentOpen.status, sentClosed.status]).toEqual([201, 201]);
    const task = await call(taskRoute.POST, { ...idOf(card.id), body: { projectId: project.id, boardId: board.id } });
    expect(task.status).toBe(201);
    const taskId = (task.json as unknown as { taskId: string }).taskId;

    const links = async (who: Person) => {
      await as(who);
      const res = await call(linksRoute.GET, idOf(card.id));
      expect(res.status).toBe(200);
      return res.json as unknown as { tasks: Array<{ id: string; title: string }>; topics: Array<{ conversationId: string; messageId: string | null; title: string }> };
    };
    const mine = await links(w.member);
    expect(mine.tasks.map((t) => t.id)).toEqual([taskId]);
    expect(mine.topics.map((t) => t.title).sort()).toEqual(["closed topic", "open topic"]);
    expect(mine.topics.every((t) => t.messageId)).toBe(true);

    // a colleague who cannot read the private topic is not shown it (nor its title)
    const other = await links(w.member2);
    expect(other.topics.map((t) => t.title)).toEqual(["open topic"]);
    expect(other.tasks.map((t) => t.id)).toEqual([taskId]);
    expect(JSON.stringify(other)).not.toContain(closed.id);
    // the owner reads every topic silently
    expect((await links(w.owner)).topics).toHaveLength(2);
    await as(w.guest);
    expect((await call(linksRoute.GET, idOf(card.id))).status).toBe(403);
  });

  it("a message that was deleted is not linked to (the topic still is)", async () => {
    const w = await world();
    const card = await newCard(w);
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "general", spaceId: w.space.id } });
    await as(w.member);
    const sent = (await call(sendRoute.POST, { ...idOf(card.id), body: { conversationId: topic.id } })).json as unknown as { messageId: string };
    await db.chatMessage.update({ where: { id: sent.messageId }, data: { deletedAt: new Date() } });
    const links = (await call(linksRoute.GET, idOf(card.id))).json as unknown as { topics: Array<{ conversationId: string; messageId: string | null }> };
    expect(links.topics).toEqual([expect.objectContaining({ conversationId: topic.id, messageId: null })]);
  });
});

// ───────────────────────────── the page itself ─────────────────────────────

describe("the page /cards/[id]", () => {
  const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
  type PageElement = { props: { initial: { card: { id: string; version: number }; abilities: Json; spaceName: string }; userId: string } };

  it("a member opens it with the card, what they may do, and their own id for the draft; a person outside the space gets not-found", async () => {
    const w = await world();
    const card = await newCard(w);
    enter(w.space.id);
    await as(w.member2);
    const page = (await CardPageRoute({ params: { id: card.id } })) as unknown as PageElement;
    expect(page.props.userId).toBe(w.member2.id);
    expect(page.props.initial.card).toMatchObject({ id: card.id, version: 1 });
    expect(page.props.initial.abilities).toMatchObject({ write: true, participate: true, internal: true });
    expect(page.props.initial.spaceName).toBe(w.space.name);

    await as(w.outsider);
    await expect(CardPageRoute({ params: { id: card.id } })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(CardPageRoute({ params: { id: "gone" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the owner opens it without a trace; an external partner opens it with nothing internal", async () => {
    const w = await world();
    const card = await newCard(w);
    enter(w.space.id);
    const before = await db.auditLog.count({ where: { OR: [{ actorId: w.owner.id }, { target: card.id }] } });
    await as(w.owner);
    const owned = (await CardPageRoute({ params: { id: card.id } })) as unknown as PageElement;
    expect(owned.props.initial.abilities).toMatchObject({ oversight: true, participate: false });
    expect(await db.auditLog.count({ where: { OR: [{ actorId: w.owner.id }, { target: card.id }] } })).toBe(before);
    expect(await db.workspaceMember.count({ where: { workspaceId: w.space.id, userId: w.owner.id } })).toBe(0);

    await as(w.guest);
    const guest = (await CardPageRoute({ params: { id: card.id } })) as unknown as PageElement;
    expect(guest.props.initial.abilities).toMatchObject({ internal: false, write: false });
  });
});
