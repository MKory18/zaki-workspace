/**
 * The archive and the oversight list are the capability `archive.view`: the OWNER's, never granted to
 * anybody else. A partner (an OWNER who is not the primary owner) holds it like every other permission —
 * which means the primary owner can take it away, and then it is GONE: the two routes must answer 403,
 * not read the owner's record because the rank still says OWNER.
 */
import { describe, expect, it } from "vitest";
import * as archiveRoute from "@/app/api/chat/archive/route";
import * as oversightRoute from "@/app/api/chat/oversight/conversations/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import { call, db, loginAs, makeTeam, uid } from "./helpers";

const patch = (orgId: string, userId: string, body: Record<string, unknown>) =>
  call(memberRoute.PATCH, { method: "PATCH", params: { id: orgId, userId }, body });
const archive = () => call(archiveRoute.GET, { url: "http://localhost/api/chat/archive" });
const oversight = () => call(oversightRoute.GET, { url: "http://localhost/api/chat/oversight/conversations" });

async function partnerWorld() {
  const team = await makeTeam();
  await loginAs(team.owner.id);
  expect((await patch(team.org.id, team.admin.id, { role: "OWNER" })).status).toBe(200);
  return team;
}

describe("archive.view: a permission taken from a partner is enforced by the archive routes", () => {
  it("a partner reads the archive and the oversight list; with archive.view revoked both answer 403; the primary owner keeps both", async () => {
    const w = await partnerWorld();

    // a partner is an OWNER for everything the owner reads
    await loginAs(w.admin.id);
    expect((await archive()).status).toBe(200);
    expect((await oversight()).status).toBe(200);

    // the primary owner takes archive.view away
    await loginAs(w.owner.id);
    expect((await patch(w.org.id, w.admin.id, { revokedCapabilities: ["archive.view"] })).status).toBe(200);

    await loginAs(w.admin.id);
    const denied = await archive();
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ error: "forbidden", message: "chat.e.archive_denied" });
    const deniedLook = await oversight();
    expect(deniedLook.status).toBe(403);
    expect(deniedLook.json).toMatchObject({ error: "forbidden", message: "chat.e.oversight_denied" });

    // the partner can not give it back to himself (nobody edits themselves)
    expect((await patch(w.org.id, w.admin.id, { revokedCapabilities: [] })).status).toBe(403);
    // and nobody hands it to anybody: `archive.view` is the primary owner's alone (owner_only), not a box to tick
    const lead = await db.organizationMember.findFirstOrThrow({ where: { organizationId: w.org.id, role: "MEMBER" } });
    const handed = await patch(w.org.id, lead.userId, { capabilities: ["archive.view"] });
    expect(handed.status).toBe(403);
    expect(handed.json).toMatchObject({ error: "forbidden", message: "accounts.cap_owner_only" });
    const untouched = await db.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: w.org.id, userId: lead.userId } },
      select: { capabilities: true },
    });
    expect(untouched.capabilities).toEqual([]);

    // the primary owner, who holds everything, reads both
    await loginAs(w.owner.id);
    expect((await archive()).status).toBe(200);
    expect((await oversight()).status).toBe(200);

    // giving the box back restores the partner's two eyes
    expect((await patch(w.org.id, w.admin.id, { revokedCapabilities: [] })).status).toBe(200);
    await loginAs(w.admin.id);
    expect((await archive()).status).toBe(200);
    expect((await oversight()).status).toBe(200);
  });
});
