import { describe, expect, it } from "vitest";
import { createDepartment, setMembers, updateDepartment } from "@/server/services/departments";
import { createTicket, listDepartmentTickets, ticketDetail } from "@/server/services/tickets";
import { campaignDetail, createCampaign, listDepartmentCampaigns } from "@/server/services/campaigns";
import { deptSpaceIdOf } from "@/server/services/department-space";
import type { OrgAccessContext } from "@/server/auth";
import { db, makeTeam, makeUser, uid } from "./helpers";

/**
 * EVERY DEPARTMENT HAS ITS SPACE, AND ITS TICKETS AND CAMPAIGNS ARE ITS OWN (the owner's decision, 2026-10-25: each
 * space is like a separate site). A new department gets its space, its people are the space's people (the lead its
 * ADMIN); a department's tickets and campaigns are read by its people, the OWNER and the ADMINs — anybody else only
 * reads the ones they raised, hold or own.
 */

const ctxOf = (orgId: string, userId: string, orgRole: OrgAccessContext["orgRole"]): OrgAccessContext => ({ orgId, userId, orgRole });

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const lead = await makeUser({ orgId, role: "LEAD", name: `Lead ${uid()}` });
  const designer = await makeUser({ orgId, role: "MEMBER", name: `Designer ${uid()}` });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: `Outsider ${uid()}` });
  const admin = ctxOf(orgId, team.admin.id, "ADMIN");
  const dept = await createDepartment(admin, { name: `Design ${uid()}`, leadId: lead.id, memberIds: [designer.id] });
  return { ...team, orgId, lead, designer, outsider, admin, dept };
}

describe("a department's space", () => {
  it("a new department gets its space: its people in it, its lead the space's ADMIN, its own talk", async () => {
    const w = await world();
    const space = await db.workspace.findUniqueOrThrow({ where: { id: deptSpaceIdOf(w.dept.id) }, select: { kind: true, departmentId: true, name: true } });
    expect(space).toMatchObject({ kind: "DEPARTMENT", departmentId: w.dept.id, name: w.dept.name });
    const rows = await db.workspaceMember.findMany({ where: { workspaceId: deptSpaceIdOf(w.dept.id) }, select: { userId: true, role: true } });
    expect(rows.find((r) => r.userId === w.lead.id)?.role).toBe("ADMIN");
    expect(rows.find((r) => r.userId === w.designer.id)?.role).toBe("MEMBER");
    expect(rows.some((r) => r.userId === w.outsider.id)).toBe(false);
    expect(await db.conversation.count({ where: { spaceId: deptSpaceIdOf(w.dept.id), kind: "TOPIC" } })).toBeGreaterThan(0);
  });

  it("joining the department joins its space; leaving it leaves it; a rename renames it", async () => {
    const w = await world();
    await setMembers(w.admin, w.dept.id, { addUserIds: [w.outsider.id], removeUserIds: [w.designer.id] });
    const ids = (await db.workspaceMember.findMany({ where: { workspaceId: deptSpaceIdOf(w.dept.id) }, select: { userId: true } })).map((r) => r.userId);
    expect(ids).toContain(w.outsider.id);
    expect(ids).not.toContain(w.designer.id);
    await updateDepartment(w.admin, w.dept.id, { name: "Brand" });
    expect((await db.workspace.findUniqueOrThrow({ where: { id: deptSpaceIdOf(w.dept.id) }, select: { name: true } })).name).toBe("Brand");
  });
});

describe("a department's tickets and campaigns are its own", () => {
  it("tickets: its people and the managers read them all; anybody else only the ones they raised", async () => {
    const w = await world();
    const designer = ctxOf(w.orgId, w.designer.id, "MEMBER");
    const outsider = ctxOf(w.orgId, w.outsider.id, "MEMBER");
    const inside = await createTicket(designer, w.dept.id, { title: "Inside work", priority: "NORMAL" });
    const raised = await createTicket(outsider, w.dept.id, { title: "Please fix", priority: "NORMAL" });

    const titles = async (who: OrgAccessContext) => (await listDepartmentTickets(w.dept.id, who)).map((t) => t.title).sort();
    expect(await titles(designer)).toEqual(["Inside work", "Please fix"]);
    expect(await titles(w.admin)).toEqual(["Inside work", "Please fix"]);
    expect(await titles(outsider)).toEqual(["Please fix"]);

    await expect(ticketDetail(outsider, inside.id)).rejects.toMatchObject({ message: "ticket.not_found" });
    await expect(ticketDetail(outsider, raised.id)).resolves.toMatchObject({ title: "Please fix" });
  });

  it("campaigns: its people and the managers read them all; anybody else only the ones they own", async () => {
    const w = await world();
    const designer = ctxOf(w.orgId, w.designer.id, "MEMBER");
    const outsider = ctxOf(w.orgId, w.outsider.id, "MEMBER");
    const campaign = await createCampaign(designer, w.dept.id, { title: "Launch week", priority: "NORMAL", startDate: "2026-11-01", endDate: "2026-11-07" });
    expect((await listDepartmentCampaigns(w.dept.id, designer)).map((c) => c.title)).toEqual(["Launch week"]);
    expect(await listDepartmentCampaigns(w.dept.id, outsider)).toEqual([]);
    await expect(campaignDetail(outsider, campaign.id)).rejects.toMatchObject({ message: "campaign.not_found" });
    await expect(campaignDetail(w.admin, campaign.id)).resolves.toMatchObject({ title: "Launch week" });
  });
});
