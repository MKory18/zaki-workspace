import { describe, expect, it } from "vitest";
import * as departmentCampaignsRoute from "@/app/api/departments/[id]/campaigns/route";
import * as campaignRoute from "@/app/api/campaigns/[id]/route";
import * as itemsRoute from "@/app/api/campaigns/[id]/items/route";
import * as itemRoute from "@/app/api/campaign-items/[itemId]/route";
import * as mineRoute from "@/app/api/campaigns/mine/route";
import { call, db, loginAs, makeTeam } from "./helpers";
import { makeCampaign, makeCampaignItem, makeDepartment, makeMember } from "./guest-helpers";

/** One org, one department with `deptMember` in it; `stranger` is an unrelated MEMBER. */
async function campaignWorld() {
  const team = await makeTeam();
  const deptMember = await makeMember(team.org.id, "Dept member");
  const stranger = await makeMember(team.org.id, "Stranger");
  const dept = await makeDepartment(team.org.id, { memberIds: [deptMember.id] });
  return { ...team, deptMember, stranger, dept };
}

const NEW_CAMPAIGN = { title: "Ramadan push", startDate: "2026-12-01", endDate: "2026-12-30" };

describe("campaigns: a GUEST cannot write", () => {
  it("cannot create a campaign, while a normal member still can", async () => {
    const w = await campaignWorld();
    await loginAs(w.guest.id);
    const res = await call(departmentCampaignsRoute.POST, { params: { id: w.dept.id }, body: NEW_CAMPAIGN });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("guest.readonly");
    expect(await db.campaign.count({ where: { orgId: w.org.id } })).toBe(0);

    await loginAs(w.stranger.id);
    const ok = await call(departmentCampaignsRoute.POST, { params: { id: w.dept.id }, body: NEW_CAMPAIGN });
    expect(ok.status).toBe(201);
  });

  it("cannot update or delete a campaign - even as its owner and a department member", async () => {
    const w = await campaignWorld();
    await db.departmentMember.create({ data: { departmentId: w.dept.id, userId: w.guest.id } });
    const campaign = await makeCampaign({ orgId: w.org.id, departmentId: w.dept.id, ownerId: w.guest.id });

    await loginAs(w.guest.id);
    const edit = await call(campaignRoute.PATCH, {
      method: "PATCH",
      params: { id: campaign.id },
      body: { status: "RUNNING", title: "Guest was here" },
    });
    expect(edit.status).toBe(403);
    expect(edit.json?.["message"]).toBe("guest.readonly");
    const del = await call(campaignRoute.DELETE, { method: "DELETE", params: { id: campaign.id } });
    expect(del.status).toBe(403);

    const row = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(row.status).toBe("DRAFT");
    expect(row.title).toBe(campaign.title);
  });

  it("cannot add, tick off or delete campaign items - even as a department member", async () => {
    const w = await campaignWorld();
    await db.departmentMember.create({ data: { departmentId: w.dept.id, userId: w.guest.id } });
    const campaign = await makeCampaign({ orgId: w.org.id, departmentId: w.dept.id, ownerId: w.deptMember.id });
    const item = await makeCampaignItem(campaign.id, "Existing post");

    await loginAs(w.guest.id);
    const add = await call(itemsRoute.POST, {
      params: { id: campaign.id },
      body: { title: "Planted post", kind: "post", dueDate: "2026-11-10" },
    });
    expect(add.status).toBe(403);
    const toggle = await call(itemRoute.POST, { params: { itemId: item.id } });
    expect(toggle.status).toBe(403);
    const del = await call(itemRoute.DELETE, { method: "DELETE", params: { itemId: item.id } });
    expect(del.status).toBe(403);

    expect(await db.campaignItem.count({ where: { campaignId: campaign.id } })).toBe(1);
    expect((await db.campaignItem.findUniqueOrThrow({ where: { id: item.id } })).doneAt).toBeNull();
  });

  it("can still read campaigns", async () => {
    const w = await campaignWorld();
    const campaign = await makeCampaign({ orgId: w.org.id, departmentId: w.dept.id, ownerId: w.deptMember.id });
    await loginAs(w.guest.id);
    expect((await call(departmentCampaignsRoute.GET, { params: { id: w.dept.id } })).status).toBe(200);
    expect((await call(campaignRoute.GET, { params: { id: campaign.id } })).status).toBe(200);
    expect((await call(mineRoute.GET)).status).toBe(200);
  });
});

describe("campaigns: the rules for everyone else are unchanged", () => {
  it("a department member and an ADMIN manage campaigns and items; an unrelated MEMBER cannot", async () => {
    const w = await campaignWorld();
    const campaign = await makeCampaign({ orgId: w.org.id, departmentId: w.dept.id, ownerId: w.owner.id });

    await loginAs(w.stranger.id);
    const denied = await call(campaignRoute.PATCH, { method: "PATCH", params: { id: campaign.id }, body: { status: "RUNNING" } });
    expect(denied.status).toBe(403);
    expect(denied.json?.["message"]).toBe("campaign.admin_only");

    for (const user of [w.deptMember, w.admin]) {
      await loginAs(user.id);
      const edit = await call(campaignRoute.PATCH, { method: "PATCH", params: { id: campaign.id }, body: { status: "RUNNING" } });
      expect(edit.status).toBe(200);

      const add = await call(itemsRoute.POST, {
        params: { id: campaign.id },
        body: { title: "Post", kind: "post", dueDate: "2026-11-12" },
      });
      expect(add.status).toBe(201);
      const itemId = (add.json?.["item"] as { id: string }).id;
      expect((await call(itemRoute.POST, { params: { itemId } })).status).toBe(200);
      expect((await call(itemRoute.DELETE, { method: "DELETE", params: { itemId } })).status).toBe(200);
    }

    await loginAs(w.deptMember.id);
    expect((await call(campaignRoute.DELETE, { method: "DELETE", params: { id: campaign.id } })).status).toBe(200);
  });
});
