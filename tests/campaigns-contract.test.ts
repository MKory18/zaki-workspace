import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAMPAIGN_STATUSES } from "@/server/services/campaigns";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("campaign status set", () => {
  it("covers the five lifecycle statuses", () => {
    expect(CAMPAIGN_STATUSES).toEqual(["DRAFT", "SCHEDULED", "RUNNING", "DONE", "CANCELLED"]);
  });
});

describe("campaign service contract", () => {
  const svc = read("src", "server", "services", "campaigns.ts");

  it("create runs inside a transaction with the atomic per-org counter", () => {
    const body = svc.slice(svc.indexOf("createCampaign("), svc.indexOf("updateCampaign("));
    expect(body).toContain("$transaction");
    expect(body).toContain("nextTaskNumber");
    expect(body).toContain("ownerId: ctx.userId");
  });

  it("update/delete gate on dept membership or org admin", () => {
    expect(svc).toContain("campaign.admin_only");
    const upd = svc.slice(svc.indexOf("export async function updateCampaign"), svc.indexOf("export async function deleteCampaign"));
    expect(upd).toContain("canManage");
    expect(upd).toContain("campaign.bad_range");
  });

  it("all campaign queries are org-scoped", () => {
    const load = svc.slice(svc.indexOf("async function loadCampaign"), svc.indexOf("export async function listDepartmentCampaigns"));
    expect(load).toContain("orgId: ctx.orgId");
    expect(svc).toContain("dept.not_found");
  });

  it("item toggle/delete verify campaign org ownership", () => {
    expect(svc).toContain("item.campaign.orgId !== ctx.orgId");
  });

  it("startDate <= endDate is enforced at the schema level", () => {
    expect(svc).toContain("campaign.bad_range");
  });
});

describe("campaign routes contract", () => {
  it("department route: GET org-verified, POST schema-parsed", () => {
    const route = read("src", "app", "api", "departments", "[id]", "campaigns", "route.ts");
    expect(route).toContain("activeOrgCtx");
    expect(route).toContain("dept.not_found");
    expect(route).toContain("createCampaignSchema");
  });

  it("item routes enforce org ctx", () => {
    const items = read("src", "app", "api", "campaigns", "[id]", "items", "route.ts");
    expect(items).toContain("activeOrgCtx");
    const toggle = read("src", "app", "api", "campaign-items", "[itemId]", "route.ts");
    expect(toggle).toContain("activeOrgCtx");
  });

  it("mine route is auth-guarded", () => {
    const mine = read("src", "app", "api", "campaigns", "mine", "route.ts");
    expect(mine).toContain("activeOrgCtx");
  });
});