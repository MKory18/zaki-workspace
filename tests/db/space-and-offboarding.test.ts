import { describe, expect, it } from "vitest";
import * as spaceRoute from "@/app/api/workspaces/[id]/route";
import { call, db, loginAs, makeUser, makeWorkspace } from "./helpers";
import { accountsApi, failWritesWhere, makeRankTeam, memberRow } from "./accounts-helpers";

/**
 * Review B items 9-11: a space with a conversation answers «not empty» in Arabic instead of a bare 409;
 * the HQ offboarding audit row is part of the offboarding transaction; a reactivated person is back in
 * «الشركة» (the owner's decision, 2026-10-24) and in nothing else.
 */
const del = (id: string) => call(spaceRoute.DELETE, { method: "DELETE", params: { id } });

describe("deleting a space that has conversations", () => {
  it("is refused with spaces.not_empty (it was a bare 409 from the database), and nothing is lost", async () => {
    const t = await makeRankTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.lead.id, role: "ADMIN" }]);
    const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
    for (const who of [t.owner.id, t.lead.id]) {
      await loginAs(who);
      const res = await del(ws.id);
      expect(res.status).toBe(409);
      expect(res.json?.["message"]).toBe("spaces.not_empty");
    }
    expect(await db.workspace.findUnique({ where: { id: ws.id } })).not.toBeNull();
    expect(await db.conversation.findUnique({ where: { id: topic.id } })).not.toBeNull();
  });

  it("an empty space, no projects and no topics, is still deleted", async () => {
    const t = await makeRankTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.lead.id, role: "ADMIN" }]);
    await loginAs(t.owner.id);
    expect((await del(ws.id)).status).toBe(200);
    expect(await db.workspace.findUnique({ where: { id: ws.id } })).toBeNull();
  });
});

describe("offboarding and the company space", () => {
  it("the HQ audit row is written in the offboarding transaction: if it fails, nobody is offboarded", async () => {
    const t = await makeRankTeam();
    const leaver = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Leaver" });
    const restore = await failWritesWhere("AuditLog", "target", leaver.id);
    try {
      await loginAs(t.owner.id);
      const res = await accountsApi.status(t.org.id, leaver.id, { action: "offboard" });
      expect(res.status).toBeGreaterThanOrEqual(400);
      // the audit failed, so the whole offboarding rolled back (it used to commit first and lose the row)
      expect((await memberRow(t.org.id, leaver.id)).status).toBe("ACTIVE");
    } finally {
      await restore();
    }
  });

  it("offboarding leaves an «org.member_offboarded_chat» trace, and reactivation brings the person back to «الشركة» only", async () => {
    const t = await makeRankTeam();
    const leaver = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Leaver" });
    const other = await makeWorkspace(t.org.id, [{ userId: leaver.id }]);
    await loginAs(t.owner.id);
    expect((await accountsApi.status(t.org.id, leaver.id, { action: "offboard" })).status).toBe(200);
    expect(await db.auditLog.count({ where: { action: "org.member_offboarded_chat", target: leaver.id } })).toBe(1);

    expect((await accountsApi.status(t.org.id, leaver.id, { action: "reactivate" })).status).toBe(200);
    const spaces = await db.workspaceMember.findMany({ where: { userId: leaver.id }, select: { workspace: { select: { id: true, kind: true } } } });
    expect(spaces.map((s) => s.workspace.kind)).toEqual(["HQ"]);
    expect(spaces.some((s) => s.workspace.id === other.id)).toBe(false);
  });
});
