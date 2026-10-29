import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-avatars-scope-${process.pid}`;
});

import * as avatarRoute from "@/app/api/me/avatar/route";
import * as avatarBytesRoute from "@/app/api/avatars/[id]/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { avatarFileIdOf } from "@/server/services/avatars";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";
/**
 * WHO SEES A FACE (the owner, 2026-10-29).
 *
 * Three rules these pin, each of which the first cut of the feature broke:
 *
 *  1. A GUEST never receives a picture address. He is refused by the bytes route (`guest.no_access`),
 *     so a URL in his payload is a broken image on his screen — the partner's chat must draw initials.
 *  2. A picture belongs to the PERSON, not to the company it was uploaded in. The same person working
 *     in two companies is one face: both sets of colleagues see it, and a third company sees 404.
 *  3. Replacing a picture leaves nothing live behind, whichever company the old one was uploaded in.
 */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

async function upload(handler: unknown, bytes: Uint8Array, name = "face.png") {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], name, { type: "image/png" }));
  const res = await (handler as Handler)(new Request("http://localhost/api/me/avatar", { method: "POST", body: form }), { params: {} });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const bytesOf = (id: string) => call(avatarBytesRoute.GET, { params: { id } });

describe("a picture never reaches a guest", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("a GUEST reading a topic gets no avatar address at all", async () => {
    const team = await makeTeam();
    // the member has a picture, and the guest shares a space with them
    await loginAs(team.member.id);
    const mine = await upload(avatarRoute.POST, PNG);
    expect(mine.status).toBe(201);
    const fileId = avatarFileIdOf(mine.json?.["avatarUrl"] as string)!;

    const space = await makeWorkspace(team.org.id, [
      { userId: team.guest.id, role: "GUEST" },
      { userId: team.member.id },
    ]);
    const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "المصنع" } });
    const topicId = topic.id;
    await call(messagesRoute.POST, { params: { id: topicId }, body: { body: "مرحبا" } });

    // the member sees the picture; the guest sees the same message with initials only
    const asMember = await call(conversationRoute.GET, { params: { id: topicId } });
    expect(asMember.text).toContain(fileId);

    await loginAs(team.guest.id);
    const asGuest = await call(conversationRoute.GET, { params: { id: topicId } });
    expect(asGuest.status).toBe(200);
    expect(asGuest.text).toContain("مرحبا");
    expect(asGuest.text).not.toContain("/api/avatars/");
  });
});

describe("a picture belongs to the person, not to one company", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("a colleague of a second company sees the same face; a third company is 404", async () => {
    const first = await makeTeam();
    await loginAs(first.member.id);
    const fileId = avatarFileIdOf((await upload(avatarRoute.POST, PNG)).json?.["avatarUrl"] as string)!;

    // the same person, active in a second company
    const second = await makeTeam();
    const secondMate = await makeUser({ orgId: second.org.id, role: "MEMBER", name: "Second mate" });
    await db.organizationMember.create({
      data: { organizationId: second.org.id, userId: first.member.id, role: "MEMBER" },
    });

    await loginAs(secondMate.id);
    expect((await bytesOf(fileId)).status).toBe(200);

    // somebody in a company this person is not in
    const third = await makeTeam();
    await loginAs(third.member.id);
    expect((await bytesOf(fileId)).status).toBe(404);
  });

  it("a new picture retires the old one even when it was uploaded in another company", async () => {
    const first = await makeTeam();
    await loginAs(first.member.id);
    const oldId = avatarFileIdOf((await upload(avatarRoute.POST, PNG)).json?.["avatarUrl"] as string)!;

    // the person moves to a second company and changes their picture there
    const second = await makeTeam();
    await db.organizationMember.create({
      data: { organizationId: second.org.id, userId: first.member.id, role: "MEMBER" },
    });
    await db.organizationMember.updateMany({
      where: { organizationId: first.org.id, userId: first.member.id },
      data: { status: "OFFBOARDED" },
    });
    await loginAs(first.member.id);
    const newId = avatarFileIdOf((await upload(avatarRoute.POST, PNG)).json?.["avatarUrl"] as string)!;
    expect(newId).not.toBe(oldId);
    expect(await db.storedFile.findUniqueOrThrow({ where: { id: oldId }, select: { deletedAt: true } })).toMatchObject({
      deletedAt: expect.any(Date),
    });
  });
});
