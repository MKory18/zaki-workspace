import { describe, expect, it } from "vitest";
import * as filesRoute from "@/app/api/files/route";
import * as fileRoute from "@/app/api/files/[id]/route";
import * as departmentTicketsRoute from "@/app/api/departments/[id]/tickets/route";
import * as ticketRoute from "@/app/api/tickets/[id]/route";
import * as mineRoute from "@/app/api/tickets/mine/route";
import * as departmentCampaignsRoute from "@/app/api/departments/[id]/campaigns/route";
import * as campaignRoute from "@/app/api/campaigns/[id]/route";
import { ensureHqSpace } from "@/server/chat/hq";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeTeam } from "./helpers";
import { makeCampaign, makeDepartment, makeTicket } from "./guest-helpers";

/**
 * The per-person section grid, batch 2 (the owner's decision, 2026-10-26): the library, the tickets and the campaigns
 * each have «يشوف / يضيف ويعدّل / يحذف», all staff's by the template, and the server answers each box.
 */
async function setBoxes(orgId: string, userId: string, lists: { capabilities?: string[]; revokedCapabilities?: string[] }) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: lists });
}

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);

async function upload(name: string) {
  const form = new FormData();
  form.set("file", new File([PNG], name, { type: "image/png" }));
  const res = await (filesRoute.POST as unknown as (req: Request) => Promise<Response>)(
    new Request("http://localhost/api/files", { method: "POST", body: form }),
  );
  return { status: res.status, json: (await res.json()) as { id: string; message?: string } };
}

async function libraryWorld() {
  const team = await makeTeam();
  const hq = await ensureHqSpace(team.org.id, "الشركة");
  await db.workspaceMember.createMany({
    data: [team.admin, team.member].map((p) => ({ workspaceId: hq, userId: p.id, role: "MEMBER" as const })),
    skipDuplicates: true,
  });
  return { ...team, hq };
}

describe("the library row: «يشوف / يضيف ويعدّل / يحذف»", () => {
  it("by the template a member lists, uploads and deletes their own file", async () => {
    const w = await libraryWorld();
    await loginAs(w.member.id);
    enter(w.hq);
    const up = await upload("price-list.png");
    expect(up.status).toBe(201);
    expect((await call(filesRoute.GET)).status).toBe(200);
    expect((await call(fileRoute.DELETE, { method: "DELETE", params: { id: up.json.id } })).status).toBe(200);
  });

  it("without «يضيف ويعدّل» no upload; without «يحذف» no delete, even of one's own file", async () => {
    const w = await libraryWorld();
    await loginAs(w.member.id);
    enter(w.hq);
    const up = await upload("spec.png");
    expect(up.status).toBe(201);

    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["files.edit", "files.delete"] });
    const refused = await upload("another.png");
    expect(refused.status).toBe(403);
    expect(refused.json.message).toBe("section.edit_denied");
    const del = await call(fileRoute.DELETE, { method: "DELETE", params: { id: up.json.id } });
    expect(del.status).toBe(403);
    expect(del.json?.["message"]).toBe("section.delete_denied");
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: up.json.id } })).deletedAt).toBeNull();
    // reading is untouched
    expect((await call(filesRoute.GET)).status).toBe(200);
  });

  it("without «يشوف» the list and a file's details are closed", async () => {
    const w = await libraryWorld();
    await loginAs(w.admin.id);
    enter(w.hq);
    const up = await upload("contract.png");
    expect(up.status).toBe(201);

    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["files.view"] });
    await loginAs(w.member.id);
    enter(w.hq);
    const list = await call(filesRoute.GET);
    expect(list.status).toBe(403);
    expect(list.json?.["message"]).toBe("section.view_denied");
    expect(list.text).not.toContain("contract.png");
    expect((await call(fileRoute.GET, { params: { id: up.json.id } })).status).toBe(403);
  });
});

async function deskWorld() {
  const team = await makeTeam();
  const dept = await makeDepartment(team.org.id, { memberIds: [team.member.id] });
  const ticket = await makeTicket({ orgId: team.org.id, departmentId: dept.id, creatorId: team.member.id, title: "Printer jam" });
  const campaign = await makeCampaign({ orgId: team.org.id, departmentId: dept.id, ownerId: team.member.id, title: "Eid sale" });
  return { ...team, dept, ticket, campaign };
}

describe("the tickets row", () => {
  it("without «يشوف» the department's desk, one's own tickets and a change are all closed", async () => {
    const w = await deskWorld();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["tickets.view"] });
    await loginAs(w.member.id);
    const desk = await call(departmentTicketsRoute.GET, { params: { id: w.dept.id } });
    expect(desk.status).toBe(403);
    expect(desk.text).not.toContain("Printer jam");
    expect((await call(mineRoute.GET)).status).toBe(403);
    const patch = await call(ticketRoute.PATCH, { method: "PATCH", params: { id: w.ticket.id }, body: { status: "IN_PROGRESS" } });
    expect(patch.status).toBe(403);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: w.ticket.id } })).status).toBe("OPEN");
  });

  it("without «يحذف» a department member still opens and changes a ticket, but can not delete it", async () => {
    const w = await deskWorld();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["tickets.delete"] });
    await loginAs(w.member.id);
    expect((await call(ticketRoute.PATCH, { method: "PATCH", params: { id: w.ticket.id }, body: { status: "IN_PROGRESS" } })).status).toBe(200);
    const created = await call(departmentTicketsRoute.POST, { params: { id: w.dept.id }, body: { title: "Toner" } });
    expect(created.status).toBe(201);
    const del = await call(ticketRoute.DELETE, { method: "DELETE", params: { id: w.ticket.id } });
    expect(del.status).toBe(403);
    expect(del.json?.["message"]).toBe("section.delete_denied");
    expect(await db.ticket.count({ where: { id: w.ticket.id } })).toBe(1);
  });
});

describe("the campaigns row", () => {
  it("without «يضيف ويعدّل» no new campaign and no change; reading stays", async () => {
    const w = await deskWorld();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["campaigns.edit"] });
    await loginAs(w.member.id);
    expect((await call(departmentCampaignsRoute.GET, { params: { id: w.dept.id } })).status).toBe(200);
    const created = await call(departmentCampaignsRoute.POST, {
      params: { id: w.dept.id },
      body: { title: "Not allowed", startDate: "2026-11-01", endDate: "2026-11-30" },
    });
    expect(created.status).toBe(403);
    const patch = await call(campaignRoute.PATCH, { method: "PATCH", params: { id: w.campaign.id }, body: { status: "RUNNING" } });
    expect(patch.status).toBe(403);
    expect(patch.json?.["message"]).toBe("section.edit_denied");
    expect((await db.campaign.findUniqueOrThrow({ where: { id: w.campaign.id } })).status).toBe("DRAFT");
  });

  it("an admin without «يحذف» can not delete a campaign", async () => {
    const w = await deskWorld();
    await setBoxes(w.org.id, w.admin.id, { revokedCapabilities: ["campaigns.delete"] });
    await loginAs(w.admin.id);
    const del = await call(campaignRoute.DELETE, { method: "DELETE", params: { id: w.campaign.id } });
    expect(del.status).toBe(403);
    expect(await db.campaign.count({ where: { id: w.campaign.id } })).toBe(1);
  });
});
