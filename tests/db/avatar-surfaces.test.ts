import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as directoryRoute from "@/app/api/chat/directory/route";
import * as departmentsRoute from "@/app/api/departments/route";
import * as workspaceMembersRoute from "@/app/api/workspaces/[id]/members/route";
import * as convCallRoute from "@/app/api/chat/conversations/[id]/call/route";
import * as callRoute from "@/app/api/calls/[id]/route";
import { roomOf, setCallsFetchForTests } from "@/server/calls/livekit";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { getPublicProfile, memberDirectory } from "@/server/services/users";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";
import { makeDepartment } from "./guest-helpers";

/**
 * THE FACE ON EVERY LIST (the owner, 2026-10-29: «خيار إن المستخدم يحط صورة بروفايل»).
 *
 * A person uploads one picture, and it must appear everywhere their name appears — the staff
 * directory, the profile page, the picker of «رسالة جديدة», a department's members, and the people
 * of a call. A list that carries the name and not the picture is the same face drawn as a letter,
 * which is the bug these pin.
 *
 * The one exception is a GUEST: the staff directory is closed to them, so their lists keep names
 * and never receive a picture address (the bytes route refuses them anyway).
 */
const FACE = "/api/avatars/face-1";

const painted = (userId: string) => db.user.update({ where: { id: userId }, data: { avatarUrl: FACE } });

const SECRET = "test-avatars-surfaces-secret-0123456789abcdef";
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) saved[k] = process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setCallsFetchForTests(null);
});
beforeEach(() => {
  process.env["LIVEKIT_URL"] = "wss://calls.test.local";
  process.env["LIVEKIT_API_KEY"] = "test-key";
  process.env["LIVEKIT_API_SECRET"] = SECRET;
});

describe("the picture travels with the person's name", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("a colleague's profile page carries it", async () => {
    const t = await makeTeam();
    await painted(t.member.id);
    await loginAs(t.admin.id);
    expect((await getPublicProfile(t.admin.id, t.member.id)).avatarUrl).toBe(FACE);
  });

  it("the staff directory (/teams) carries it, and a GUEST gets none", async () => {
    const t = await makeTeam();
    await painted(t.member.id);
    await loginAs(t.admin.id);
    const staff = (await memberDirectory(t.admin.id))[0]!;
    expect(staff.members.find((m) => m.userId === t.member.id)?.avatarUrl).toBe(FACE);

    await loginAs(t.guest.id);
    const guestView = (await memberDirectory(t.guest.id))[0]!;
    for (const m of guestView.members) expect(m.avatarUrl).toBeNull();
  });

  it("the people of a space carry it for a member, and stay names-only for a guest", async () => {
    const t = await makeTeam();
    await painted(t.member.id);
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id }, { userId: t.guest.id, role: "GUEST" }]);

    await loginAs(t.admin.id);
    const res = await call(workspaceMembersRoute.GET, { params: { id: ws.id } });
    const members = res.json?.["members"] as { id: string; avatarUrl?: string | null }[];
    expect(members.find((m) => m.id === t.member.id)?.avatarUrl).toBe(FACE);

    await loginAs(t.guest.id);
    const guest = await call(workspaceMembersRoute.GET, { params: { id: ws.id } });
    for (const m of guest.json?.["members"] as Record<string, unknown>[]) expect(Object.keys(m).sort()).toEqual(["id", "name"]);
  });

  it("the picker of «رسالة جديدة» carries it", async () => {
    const t = await makeTeam();
    await painted(t.member.id);
    // the picker is the people of the space the person is in, so both must share one
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id }]);
    await loginAs(t.admin.id);
    (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, ws.id);
    const res = await call(directoryRoute.GET);
    const people = res.json?.["people"] as { userId: string; user: { avatarUrl?: string | null } }[];
    expect(people.find((p) => p.userId === t.member.id)?.user.avatarUrl).toBe(FACE);
  });

  it("a department's people carry it", async () => {
    const t = await makeTeam();
    await painted(t.member.id);
    await makeDepartment(t.org.id, { memberIds: [t.member.id] });
    await loginAs(t.admin.id);
    const res = await call(departmentsRoute.GET);
    const departments = res.json?.["departments"] as { members: { id: string; avatarUrl?: string | null }[] }[];
    const row = departments.flatMap((d) => d.members).find((m) => m.id === t.member.id);
    expect(row?.avatarUrl).toBe(FACE);
  });

  it("a call carries the picture of whoever is in the room, and of whoever started it", async () => {
    const t = await makeTeam();
    await painted(t.member.id);
    await painted(t.admin.id);
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id }]);
    const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });

    await loginAs(t.member.id);
    const started = await call(convCallRoute.POST, { params: { id: topic.id }, body: { video: false, ring: true } });
    const callId = started.json?.["id"] as string;
    expect(callId).toBeTruthy();

    const room = roomOf(callId);
    setCallsFetchForTests(async (input) => {
      if (String(input).endsWith("/ListParticipants")) {
        return Response.json({
          participants: [t.member.id, t.admin.id].map((identity) => ({ identity, name: identity, tracks: [] })),
        });
      }
      return new Response("?", { status: 400 });
    });

    const res = await call(callRoute.GET, { params: { id: callId } });
    expect(res.status).toBe(200);
    const view = res.json as { startedBy: { avatarUrl?: string | null }; people: { userId: string; avatarUrl?: string | null }[] };
    expect(view.startedBy.avatarUrl).toBe(FACE);
    expect(view.people.find((p) => p.userId === t.admin.id)?.avatarUrl).toBe(FACE);
    expect(room).toBeTruthy();
  });
});
