import { describe, expect, it } from "vitest";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import BoardPage from "@/app/(app)/boards/[id]/page";
import { call, db, loginAs, makeProject, makeTeam, makeWorkspace } from "./helpers";
// the pages are TSX: the helpers put React where their JSX looks for it
import "./pages-access-helpers";
import type { PageElement } from "./pages-access-helpers";

/**
 * The section grid's last mile (2026-10-26): what a person may not do is not offered. A message's «حوّلها لمهمة /
 * لتذكرة» and a board's add and drag follow the tasks / tickets «يضيف ويعدّل» boxes.
 */
async function setBoxes(orgId: string, userId: string, lists: { revokedCapabilities?: string[] }) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: lists });
}

describe("what is offered follows the boxes", () => {
  it("a topic tells the screen whether a message can become a task or a ticket", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }]);
    const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
    await loginAs(t.member.id);
    const me = async () => ((await call(conversationRoute.GET, { params: { id: topic.id } })).json as { me: Record<string, unknown> }).me;
    expect(await me()).toMatchObject({ canMakeWork: true, canMakeTask: true, canMakeTicket: true });
    await setBoxes(t.org.id, t.member.id, { revokedCapabilities: ["tasks.edit"] });
    expect(await me()).toMatchObject({ canMakeTask: false, canMakeTicket: true });
  });

  it("a board is read-only for a space member without the tasks «يضيف ويعدّل»", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }]);
    const { board } = await makeProject(ws.id, "Launch");
    await loginAs(t.member.id);
    expect(((await BoardPage({ params: { id: board.id } })) as PageElement).props["canEdit"]).toBe(true);
    await setBoxes(t.org.id, t.member.id, { revokedCapabilities: ["tasks.edit"] });
    expect(((await BoardPage({ params: { id: board.id } })) as PageElement).props["canEdit"]).toBe(false);
  });
});
