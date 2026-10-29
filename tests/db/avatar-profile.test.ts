import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// the uploads of this file live in a throw-away folder, never in the repository
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-avatars-${process.pid}`;
});

import * as avatarRoute from "@/app/api/me/avatar/route";
import * as avatarBytesRoute from "@/app/api/avatars/[id]/route";
import { AVATAR_MAX_BYTES, avatarFileIdOf } from "@/server/services/avatars";
import { call, db, loginAs, logout, makeTeam } from "./helpers";

/**
 * THE PROFILE PICTURE (the owner, 2026-10-29: «خيار إن المستخدم يحط صورة بروفايل»).
 *
 * The rules these pin, in the order the design states them:
 *  - the bytes decide the type (a renamed executable is refused), and only a still picture is a face;
 *  - a picture is 2 MB at most;
 *  - a GUEST has no picture and may not read one (the staff directory is closed to them);
 *  - replacing a picture leaves nothing behind: the old row is soft-deleted;
 *  - another company never reads my face (404, never a leak);
 *  - DELETE goes back to the initials.
 */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4]);
const TEXT = new TextEncoder().encode("this is not a picture at all, whatever you call it");

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

async function upload(handler: unknown, bytes: Uint8Array, name = "face.png", type = "image/png") {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], name, { type }));
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

describe("POST /api/me/avatar — my picture", () => {
  beforeEach(async () => {
    await db.user.updateMany({ data: { avatarUrl: null } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("stores a real PNG and points my row at it", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const res = await upload(avatarRoute.POST, PNG);
    expect(res.status).toBe(201);
    const url = res.json?.["avatarUrl"] as string;
    expect(url).toMatch(/^\/api\/avatars\/[A-Za-z0-9_-]+$/);
    expect((await db.user.findUniqueOrThrow({ where: { id: t.member.id }, select: { avatarUrl: true } })).avatarUrl).toBe(url);
    // and the bytes come back to a colleague
    const id = avatarFileIdOf(url)!;
    const mine = await bytesOf(id);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/png");
  });

  it("refuses bytes that are not a picture, whatever the file is called", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const res = await upload(avatarRoute.POST, TEXT, "face.png", "image/png");
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("avatar.unsupported");
    expect((await db.user.findUniqueOrThrow({ where: { id: t.member.id } })).avatarUrl).toBeNull();
  });

  it("refuses an animated GIF and anything above 2 MB", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    expect((await upload(avatarRoute.POST, GIF, "face.gif", "image/gif")).status).toBe(403);
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
    big.set(PNG);
    const res = await upload(avatarRoute.POST, big);
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("avatar.too_large");
  });

  it("a new picture replaces the old one and leaves no live row behind", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const first = avatarFileIdOf((await upload(avatarRoute.POST, PNG)).json?.["avatarUrl"] as string)!;
    const second = avatarFileIdOf((await upload(avatarRoute.POST, PNG)).json?.["avatarUrl"] as string)!;
    expect(second).not.toBe(first);
    expect(await db.storedFile.findUniqueOrThrow({ where: { id: first }, select: { deletedAt: true } })).toMatchObject({ deletedAt: expect.any(Date) });
    // the old address is gone, the new one works
    expect((await bytesOf(first)).status).toBe(404);
    expect((await bytesOf(second)).status).toBe(200);
  });

  it("a GUEST has no picture, and may not read one either", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const id = avatarFileIdOf((await upload(avatarRoute.POST, PNG)).json?.["avatarUrl"] as string)!;
    await loginAs(t.guest.id);
    expect((await upload(avatarRoute.POST, PNG)).status).toBe(403);
    expect((await bytesOf(id)).status).toBe(403);
  });

  it("another company reads nothing (404), and a signed-out caller is refused", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const id = avatarFileIdOf((await upload(avatarRoute.POST, PNG)).json?.["avatarUrl"] as string)!;
    const other = await makeTeam();
    await loginAs(other.member.id);
    expect((await bytesOf(id)).status).toBe(404);
    logout();
    expect((await bytesOf(id)).status).toBe(401);
  });

  it("DELETE takes the picture away and soft-deletes its bytes", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const id = avatarFileIdOf((await upload(avatarRoute.POST, PNG)).json?.["avatarUrl"] as string)!;
    expect((await call(avatarRoute.DELETE)).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: t.member.id } })).avatarUrl).toBeNull();
    expect((await bytesOf(id)).status).toBe(404);
  });
});
