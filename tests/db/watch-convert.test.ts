import { describe, expect, it, vi } from "vitest";

// the page calls redirect()/notFound(); no running Next app is needed here
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import * as watchRoute from "@/app/api/watch/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as taskRoute from "@/app/api/chat/messages/[id]/task/route";
import * as ideasRoute from "@/app/api/ideas/route";
import WatchSessionPage from "@/app/(app)/watch/[id]/page";
import { SPACE_COOKIE, goHref } from "@/server/services/current-space";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace } from "./helpers";

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
const LINK = "https://youtu.be/dQw4w9WgXcQ";

async function world() {
  const t = await makeTeam();
  const colleague = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Colleague" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: colleague.id }]);
  await loginAs(t.member.id);
  jar().set(SPACE_COOKIE, ws.id);
  const id = (await call(watchRoute.POST, { body: { url: LINK, memberIds: [colleague.id] } })).json?.["id"] as string;
  const session = await db.watchSession.findUniqueOrThrow({ where: { id } });
  const comment = await call(messagesRoute.POST, {
    method: "POST",
    params: { id: session.conversationId },
    body: { body: "نعمل فيديو متله لمنتجنا", videoAtSec: 754.6 },
  });
  return { ...t, colleague, ws, id, session, commentId: comment.json?.["id"] as string };
}

describe("«حوّل»: a session comment becomes work, with the way back to its moment", () => {
  it("«لمهمة»: the task made from the comment links to the same second of the video", async () => {
    const w = await world();
    const { project, board } = await makeProject(w.ws.id);
    const res = await call(taskRoute.POST, {
      method: "POST",
      params: { id: w.commentId },
      body: { workspaceId: w.ws.id, projectId: project.id, boardId: board.id },
    });
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: res.json?.["taskId"] as string } });
    expect(task.title).toBe("نعمل فيديو متله لمنتجنا");
    expect(task.description).toContain(`/watch/${w.id}?t=754`);
    expect(task.sourceMessageId).toBe(w.commentId);
  });

  it("an ordinary chat message still becomes a task without any video link", async () => {
    const w = await world();
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "General" } });
    const msg = await call(messagesRoute.POST, { method: "POST", params: { id: topic.id }, body: { body: "شغلة عادية" } });
    const { project, board } = await makeProject(w.ws.id);
    const res = await call(taskRoute.POST, { method: "POST", params: { id: msg.json?.["id"] as string }, body: { workspaceId: w.ws.id, projectId: project.id, boardId: board.id } });
    expect(res.status).toBe(201);
    expect((await db.task.findUniqueOrThrow({ where: { id: res.json?.["taskId"] as string } })).description).not.toContain("/watch/");
  });

  it("«لفكرة»: the idea is born in the session's space; somebody whose «الأفكار» box is off is refused", async () => {
    const w = await world();
    const res = await call(ideasRoute.POST, { body: { title: "نعمل فيديو متله لمنتجنا", description: `… /watch/${w.id}?t=754` } });
    expect(res.status).toBe(201);
    const idea = await db.idea.findFirstOrThrow({ where: { title: "نعمل فيديو متله لمنتجنا" } });
    expect(idea.workspaceId).toBe(w.ws.id);

    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { revokedCapabilities: ["ideas.edit"] },
    });
    const refused = await call(ideasRoute.POST, { body: { title: "فكرة تانية", description: null } });
    expect(refused.status).toBe(403);
  });

  it("a link to a moment keeps its second when the page first takes the person into the session's space", async () => {
    const w = await world();
    const other = await makeWorkspace(w.org.id, [{ userId: w.member.id }]);
    await loginAs(w.member.id);
    jar().set(SPACE_COOKIE, other.id);
    await expect(WatchSessionPage({ params: { id: w.id }, searchParams: { t: "754" } })).rejects.toThrow(
      `NEXT_REDIRECT:${goHref(w.ws.id, `/watch/${w.id}?t=754`)}`,
    );
    // a `t` that is not a second is not carried along
    await expect(WatchSessionPage({ params: { id: w.id }, searchParams: { t: "abc" } })).rejects.toThrow(
      `NEXT_REDIRECT:${goHref(w.ws.id, `/watch/${w.id}`)}`,
    );
  });
});
