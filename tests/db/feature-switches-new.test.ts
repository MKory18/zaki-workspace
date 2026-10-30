import { describe, expect, it } from "vitest";
import * as presenceRoute from "@/app/api/presence/route";
import * as avatarRoute from "@/app/api/me/avatar/route";
import { conversationDetail } from "@/server/chat/topics";
import { withFeature } from "@/lib/features";
import type { Prisma } from "@prisma/client";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * The three features of 2026-10-29 each sit behind their own switch (`src/lib/features.ts`), and a
 * switch is only honest if something reads it: off, the feature is gone and nothing it stored is lost.
 *
 *  - «الصورة الشخصية» (`avatars`): the upload and the removal answer «not found»; the picture already
 *    uploaded keeps showing.
 *  - «شريط الموجودين» (`peopleDock`): the roster answers «not found», so the strip has nothing to draw.
 *  - «شكل الرسائل الحديث» (`chatBubbles`): the conversation says so, and the log draws the older bubble
 *    with no day lines. The messages themselves are untouched either way.
 */

async function off(orgId: string, key: "avatars" | "peopleDock" | "chatBubbles") {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, false) as Prisma.InputJsonValue } });
}

describe("«الصورة الشخصية»: off, nobody changes a picture and nothing uploaded is lost", () => {
  it("the upload answers 404 while the switch is off, and 400 (a real answer) once it is back on", async () => {
    const team = await makeTeam();
    await off(team.org.id, "avatars");
    await loginAs(team.member.id);
    // an empty body is refused either way; what matters is that OFF refuses BEFORE reading anything
    const whileOff = await call(avatarRoute.POST, { method: "POST" });
    expect(whileOff.status).toBe(404);
    expect(whileOff.json?.["message"]).toBe("features.off");

    const org = await db.organization.findUniqueOrThrow({ where: { id: team.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: team.org.id }, data: { settings: withFeature(org.settings, "avatars", true) as Prisma.InputJsonValue } });
    const whileOn = await call(avatarRoute.POST, { method: "POST" });
    expect(whileOn.status).toBe(400);
  });

  it("removing a picture answers 404 while the switch is off, and the stored picture stays", async () => {
    const team = await makeTeam();
    await db.user.update({ where: { id: team.member.id }, data: { avatarUrl: "/api/avatars/keep-me" } });
    await off(team.org.id, "avatars");
    await loginAs(team.member.id);
    const res = await call(avatarRoute.DELETE, { method: "DELETE" });
    expect(res.status).toBe(404);
    const after = await db.user.findUniqueOrThrow({ where: { id: team.member.id }, select: { avatarUrl: true } });
    expect(after.avatarUrl).toBe("/api/avatars/keep-me");
  });
});

describe("«شريط الموجودين»: off, the roster answers «not found»", () => {
  it("the dock's route is 404 while the switch is off, and the staff list is back when it is on", async () => {
    const team = await makeTeam();
    await off(team.org.id, "peopleDock");
    await loginAs(team.member.id);
    const whileOff = await call(presenceRoute.GET);
    expect(whileOff.status).toBe(404);
    expect(whileOff.json?.["message"]).toBe("features.off");

    const org = await db.organization.findUniqueOrThrow({ where: { id: team.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: team.org.id }, data: { settings: withFeature(org.settings, "peopleDock", true) as Prisma.InputJsonValue } });
    const whileOn = await call(presenceRoute.GET);
    expect(whileOn.status).toBe(200);
  });
});

describe("«شكل الرسائل الحديث»: off, the screen is told to draw the older bubble", () => {
  it("the conversation carries the switch, and its messages are the same either way", async () => {
    const team = await makeTeam();
    const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: team.owner.id, role: "ADMIN" }]);
    const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "موضوع" } });
    await db.chatMessage.create({ data: { orgId: team.org.id, conversationId: topic.id, authorId: team.member.id, body: "مرحبا" } });
    await loginAs(team.member.id);
    const on = await conversationDetail({ orgId: team.org.id, userId: team.member.id, orgRole: "MEMBER" } as never, topic.id);
    expect(on.chatBubbles).toBe(true);

    await off(team.org.id, "chatBubbles");
    const offDetail = await conversationDetail({ orgId: team.org.id, userId: team.member.id, orgRole: "MEMBER" } as never, topic.id);
    expect(offDetail.chatBubbles).toBe(false);
    // nothing of the conversation is lost by switching the shape off
    expect(offDetail.messages.map((m) => m.body)).toEqual(on.messages.map((m) => m.body));
    expect(offDetail.messages.map((m) => m.id)).toEqual(on.messages.map((m) => m.id));
  });
});
